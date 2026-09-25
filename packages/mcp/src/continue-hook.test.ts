import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { disableContinueHook, disabledFlagPath, enableContinueHook } from "./continue-hook.js";

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
    enableContinueHook(path.join(root, ".bowman"), "claude");
    assert.equal(runHook(root).decision, "block");

    disableContinueHook(path.join(root, ".bowman"));
    assert.ok(fs.existsSync(disabledFlagPath(root)));
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
