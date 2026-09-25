// Enable/disable the Aimparency Stop continuation hook for a target repository.
// Disabling only creates a per-clone flag file the hook script checks on every
// Stop, so it takes effect immediately without the agent reloading its hook
// config. Kept free of server / tRPC imports so it stays unit-testable.
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export const CONTINUE_HOOK_AGENTS = ["claude", "codex", "agy"] as const;
export type ContinueHookAgent = (typeof CONTINUE_HOOK_AGENTS)[number];

const HOOKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/hooks");
const HOOK_RELATIVE_PATH = path.join("scripts", "hooks", "codex-continue-on-stop.sh");
const DISABLED_FLAG_NAME = "aimparency-continue-disabled";
const RECOGNIZED_HOOK_LINE = "Continue the current Codex conversation through the Aimparency MCP loop.";

export function resolveRepoRoot(projectPath: string): string {
  const dir = path.basename(projectPath) === ".bowman" ? path.dirname(projectPath) : projectPath;
  return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

export function disabledFlagPath(repoRoot: string): string {
  return execFileSync(
    "git",
    ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-path", DISABLED_FLAG_NAME],
    { encoding: "utf8" },
  ).trim();
}

export function enableContinueHook(projectPath: string, agent?: string, hooksDir = HOOKS_DIR): string {
  const repoRoot = resolveRepoRoot(projectPath);
  // Clear the flag first: the installer's smoke test expects the hook to block.
  fs.rmSync(disabledFlagPath(repoRoot), { force: true });

  if (agent !== undefined) {
    if (!(CONTINUE_HOOK_AGENTS as readonly string[]).includes(agent)) {
      throw new Error(`agent must be one of ${CONTINUE_HOOK_AGENTS.join(", ")}`);
    }
    execFileSync(path.join(hooksDir, "install.sh"), ["--target", repoRoot, "--agent", agent], { encoding: "utf8" });
    return `Installed (idempotent) and enabled the Aimparency continuation hook for ${agent} in ${repoRoot}. If the ${agent} session was already running before a first install, reload its hooks (Claude: /hooks; Codex: restart and trust).`;
  }

  if (!fs.existsSync(path.join(repoRoot, HOOK_RELATIVE_PATH))) {
    throw new Error(`No continuation hook installed in ${repoRoot}; pass agent (${CONTINUE_HOOK_AGENTS.join("|")}) to install it.`);
  }
  return `Enabled the Aimparency continuation hook in ${repoRoot}. It applies from the next Stop.`;
}

export function disableContinueHook(projectPath: string, hooksDir = HOOKS_DIR): string {
  const repoRoot = resolveRepoRoot(projectPath);
  const installed = path.join(repoRoot, HOOK_RELATIVE_PATH);
  const notes: string[] = [];

  // Copies installed before the off switch existed never check the flag; upgrade
  // a recognized Aimparency script in place (config untouched) so disabling works.
  if (fs.existsSync(installed)) {
    const current = fs.readFileSync(installed, "utf8");
    if (!current.includes(DISABLED_FLAG_NAME) && current.includes(RECOGNIZED_HOOK_LINE)) {
      fs.copyFileSync(path.join(hooksDir, "codex-continue-on-stop.sh"), installed);
      fs.chmodSync(installed, 0o755);
      notes.push("upgraded the installed hook script so it honors the off switch");
    }
  }

  fs.writeFileSync(disabledFlagPath(repoRoot), `disabled ${new Date().toISOString()}\n`);
  return `Disabled the Aimparency continuation hook in ${repoRoot}; agents may stop normally from the next Stop.${notes.length ? ` Also ${notes.join("; ")}.` : ""}`;
}
