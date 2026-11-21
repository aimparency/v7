import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { continueHookStatus, currentProgressLog, defaultHookLoop, deleteHookLoop, disableContinueHook, disabledFlagPath, enableContinueHook, listHookLoops, parseHookLoop, saveHookLoop, serializeHookLoop } from "./continue-hook.js";

function makeProject(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "continue-hook-")));
  fs.mkdirSync(path.join(root, ".bowman"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  return root;
}

function runHook(root: string): any {
  const hook = path.join(root, "scripts/hooks/codex-continue-on-stop.sh");
  return JSON.parse(execFileSync(hook, { input: '{"hook_event_name":"Stop"}\n', encoding: "utf8", cwd: root, env: { ...process.env, AIMPARENCY_ALLOW_STOP: "" } }));
}

test("enable installs, disable lets the hook yield, enable re-arms it", () => {
  const root = makeProject();
  try {
    assert.deepEqual(continueHookStatus(root), { installed: false, enabled: false, loop: null });
    enableContinueHook(path.join(root, ".bowman"), { agent: "claude" });
    assert.equal(runHook(root).decision, "block");
    assert.deepEqual(continueHookStatus(root), { installed: true, enabled: true, loop: null });

    disableContinueHook(path.join(root, ".bowman"));
    assert.ok(fs.existsSync(disabledFlagPath(root)));
    assert.deepEqual(continueHookStatus(path.join(root, ".bowman")), { installed: true, enabled: false, loop: null });
    assert.equal(runHook(root).continue, true);

    enableContinueHook(path.join(root, ".bowman"));
    assert.ok(!fs.existsSync(disabledFlagPath(root)));
    assert.equal(runHook(root).decision, "block");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("enable without agent refuses when nothing is installed", () => {
  const root = makeProject();
  try {
    assert.throws(() => enableContinueHook(path.join(root, ".bowman")), /pass agent/);
    assert.throws(() => enableContinueHook(path.join(root, ".bowman"), { agent: "vim" }), /agent must be one of/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("disable upgrades an old recognized hook copy that lacks the off switch", () => {
  const root = makeProject();
  try {
    const hook = path.join(root, "scripts/hooks/codex-continue-on-stop.sh");
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, "#!/usr/bin/env bash\n# Continue the current Codex conversation through the Aimparency MCP loop.\ncat >/dev/null\nprintf '{\"decision\":\"block\",\"reason\":\"old\"}\\n'\n", { mode: 0o755 });

    const message = disableContinueHook(path.join(root, ".bowman"));
    assert.match(message, /upgraded/);
    assert.equal(runHook(root).continue, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the old flag inside .git still disables, and toggling moves it to .bowman/runtime", () => {
  const root = makeProject();
  try {
    enableContinueHook(path.join(root, ".bowman"), { agent: "claude" });
    const legacy = path.join(root, ".git", "aimparency-continue-disabled");
    fs.writeFileSync(legacy, "disabled\n");
    assert.equal(runHook(root).continue, true);
    assert.deepEqual(continueHookStatus(root), { installed: true, enabled: false, loop: null });

    disableContinueHook(path.join(root, ".bowman"));
    assert.ok(!fs.existsSync(legacy));
    assert.equal(disabledFlagPath(root), path.join(root, ".bowman", "runtime", "continue-hook-disabled"));
    assert.ok(fs.existsSync(disabledFlagPath(root)));

    fs.writeFileSync(legacy, "disabled\n");
    enableContinueHook(path.join(root, ".bowman"));
    assert.ok(!fs.existsSync(legacy));
    assert.equal(runHook(root).decision, "block");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("each enable starts a timestamped progress log the hook points the agent to; disable closes it", () => {
  const root = makeProject();
  try {
    assert.equal(currentProgressLog(root), null);
    const message = enableContinueHook(path.join(root, ".bowman"), { agent: "claude" });
    const log = currentProgressLog(root)!;
    assert.match(path.relative(root, log), /^\.bowman\/runtime\/continue-logs\/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.md$/);
    assert.ok(message.includes(path.relative(root, log)));
    assert.match(fs.readFileSync(log, "utf8"), /^# Autonomous run, started /);
    assert.ok(runHook(root).reason.includes(`append one succinct line to ${log}`));

    disableContinueHook(path.join(root, ".bowman"));
    assert.equal(currentProgressLog(root), null);
    assert.match(fs.readFileSync(log, "utf8"), /Hook disabled .*\n$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("enabling without agent refreshes an outdated recognized hook copy so it logs", () => {
  const root = makeProject();
  try {
    enableContinueHook(path.join(root, ".bowman"), { agent: "claude" });
    const hook = path.join(root, "scripts/hooks/codex-continue-on-stop.sh");
    fs.writeFileSync(hook, "#!/usr/bin/env bash\n# Continue the current Codex conversation through the Aimparency MCP loop.\ncat >/dev/null\nprintf '{\"decision\":\"block\",\"reason\":\"old\"}\\n'\n", { mode: 0o755 });
    assert.match(enableContinueHook(path.join(root, ".bowman")), /upgraded/);
    assert.ok(runHook(root).reason.includes(currentProgressLog(root)!));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a hook loop file round-trips; the human section is optional", () => {
  const loop = { title: "Refactor", work: "Tidy one module.", human: "Look again first." };
  assert.deepEqual(parseHookLoop("refactor", serializeHookLoop(loop)), { slug: "refactor", ...loop });
  assert.deepEqual(parseHookLoop("x", serializeHookLoop({ ...loop, human: "" })), { slug: "x", title: "Refactor", work: "Tidy one module.", human: "" });
  const fallback = defaultHookLoop();
  assert.equal(fallback.slug, "default");
  assert.match(fallback.work, /get_prioritized_ideas/);
  assert.match(fallback.human, /AIMPARENCY_CONFIRM_HUMAN_BLOCK/);
});

test("saved loops: the default is never overwritten, selecting one changes the hook text, deleting falls back", () => {
  const root = makeProject();
  try {
    const graph = path.join(root, ".bowman");
    enableContinueHook(graph, { agent: "claude" });
    const fromDefault = saveHookLoop(graph, { slug: "default", title: "Default", work: "Mine.", human: "" });
    assert.equal(fromDefault, "default-copy");
    const slug = saveHookLoop(graph, { title: "Ideation & experiments", work: "Dream up three hypotheses.", human: "" });
    assert.equal(slug, "ideation-experiments");
    assert.equal(saveHookLoop(graph, { title: "Ideation & experiments", work: "Again.", human: "" }), "ideation-experiments-2");
    assert.deepEqual(listHookLoops(graph).map(loop => loop.slug), ["default", "default-copy", "ideation-experiments", "ideation-experiments-2"]);
    assert.ok(fs.existsSync(path.join(root, ".bowman/hook-loops/ideation-experiments.md")));

    const log = currentProgressLog(root)!;
    enableContinueHook(graph, { loop: slug });
    assert.equal(currentProgressLog(root), log, "switching keeps the run's log");
    assert.deepEqual(continueHookStatus(graph), { installed: true, enabled: true, loop: slug });
    assert.ok(runHook(root).reason.startsWith("Dream up three hypotheses."));

    saveHookLoop(graph, { slug, title: "Ideation", work: "Changed.", human: "" });
    assert.ok(runHook(root).reason.startsWith("Changed."));

    deleteHookLoop(graph, slug);
    assert.equal(continueHookStatus(graph).loop, null);
    assert.match(runHook(root).reason, /get_prioritized_ideas/);
    assert.throws(() => enableContinueHook(graph, { loop: "gone" }), /No hook loop/);
    assert.throws(() => deleteHookLoop(graph, "../x"), /Not a hook loop/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
