import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { continueHookStatus, currentProgressLog, disableContinueHook, disabledFlagPath, enableContinueHook } from "./continue-hook.js";

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
    assert.deepEqual(continueHookStatus(root), { installed: false, enabled: false });
    enableContinueHook(path.join(root, ".bowman"), "claude");
    assert.equal(runHook(root).decision, "block");
    assert.deepEqual(continueHookStatus(root), { installed: true, enabled: true });

    disableContinueHook(path.join(root, ".bowman"));
    assert.ok(fs.existsSync(disabledFlagPath(root)));
    assert.deepEqual(continueHookStatus(path.join(root, ".bowman")), { installed: true, enabled: false });
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
    assert.throws(() => enableContinueHook(path.join(root, ".bowman"), "vim"), /agent must be one of/);
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
    enableContinueHook(path.join(root, ".bowman"), "claude");
    const legacy = path.join(root, ".git", "aimparency-continue-disabled");
    fs.writeFileSync(legacy, "disabled\n");
    assert.equal(runHook(root).continue, true);
    assert.deepEqual(continueHookStatus(root), { installed: true, enabled: false });

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
    const message = enableContinueHook(path.join(root, ".bowman"), "claude");
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
    enableContinueHook(path.join(root, ".bowman"), "claude");
    const hook = path.join(root, "scripts/hooks/codex-continue-on-stop.sh");
    fs.writeFileSync(hook, "#!/usr/bin/env bash\n# Continue the current Codex conversation through the Aimparency MCP loop.\ncat >/dev/null\nprintf '{\"decision\":\"block\",\"reason\":\"old\"}\\n'\n", { mode: 0o755 });
    assert.match(enableContinueHook(path.join(root, ".bowman")), /upgraded/);
    assert.ok(runHook(root).reason.includes(currentProgressLog(root)!));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
