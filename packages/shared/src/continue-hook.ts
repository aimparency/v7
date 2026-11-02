// Enable/disable the Aimparency Stop continuation hook for a target repository.
// Disabling only creates a flag file in .bowman/runtime/ (machine-local,
// gitignored) that the hook script checks on every Stop, so it takes effect
// immediately without the agent reloading its hook config. Kept free of server
// / tRPC imports so it stays unit-testable.
//
// Enabling also starts a timestamped progress log in .bowman/runtime/continue-logs/;
// a pointer file names the current one, and the hook tells the agent to append
// one succinct line per finished step, so the human can review the run later.
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { packageRoot } from "./node-entry.js";

export const CONTINUE_HOOK_AGENTS = ["claude", "codex", "agy"] as const;

const HOOKS_DIR = path.resolve(packageRoot(import.meta.url), "../../scripts/hooks");
const HOOK_RELATIVE_PATH = path.join("scripts", "hooks", "codex-continue-on-stop.sh");
const DISABLED_FLAG = path.join(".bowman", "runtime", "continue-hook-disabled");
const LOG_POINTER = path.join(".bowman", "runtime", "continue-hook-log");
const LOG_DIR = path.join(".bowman", "runtime", "continue-logs");
// Where the flag lived before (per clone, inside .git); still honored and cleared.
const LEGACY_FLAG_NAME = "aimparency-continue-disabled";
const RECOGNIZED_HOOK_LINE = "Continue the current Codex conversation through the Aimparency MCP loop.";

export function resolveRepoRoot(projectPath: string): string {
  const dir = path.basename(projectPath) === ".bowman" ? path.dirname(projectPath) : projectPath;
  return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

export function disabledFlagPath(repoRoot: string): string {
  return path.join(repoRoot, DISABLED_FLAG);
}

function legacyFlagPath(repoRoot: string): string {
  return execFileSync(
    "git",
    ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-path", LEGACY_FLAG_NAME],
    { encoding: "utf8" },
  ).trim();
}

const isDisabled = (repoRoot: string) => fs.existsSync(disabledFlagPath(repoRoot)) || fs.existsSync(legacyFlagPath(repoRoot));
const clearFlags = (repoRoot: string) => {
  for (const flag of [disabledFlagPath(repoRoot), legacyFlagPath(repoRoot)]) fs.rmSync(flag, { force: true });
};

export function progressLogPointerPath(repoRoot: string): string {
  return path.join(repoRoot, LOG_POINTER);
}

/** Absolute path of the progress log the hook currently points agents to, if any. */
export function currentProgressLog(repoRoot: string): string | null {
  const pointer = progressLogPointerPath(repoRoot);
  return fs.existsSync(pointer) ? path.join(repoRoot, fs.readFileSync(pointer, "utf8").trim()) : null;
}

function startProgressLog(repoRoot: string, now = new Date()): string {
  const relative = path.join(LOG_DIR, `${now.toISOString().slice(0, 19).replace(/:/g, "-")}.md`);
  let head = "no commit yet";
  try {
    head = execFileSync("git", ["-C", repoRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // empty repository
  }
  fs.mkdirSync(path.join(repoRoot, LOG_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, relative),
    `# Autonomous run, started ${now.toISOString()} at ${head}\n\nOne line per finished step: idea, what changed, commit (or the question it is parked on).\n\n`,
  );
  fs.writeFileSync(progressLogPointerPath(repoRoot), `${relative}\n`);
  return relative;
}

function closeProgressLog(repoRoot: string): void {
  const log = currentProgressLog(repoRoot);
  if (log && fs.existsSync(log)) fs.appendFileSync(log, `\nHook disabled ${new Date().toISOString()}.\n`);
  fs.rmSync(progressLogPointerPath(repoRoot), { force: true });
}

// Our hook copies are ours to refresh (install.sh overwrites them too): bring a
// recognized but outdated copy in another repository up to date.
function upgradeRecognizedHook(repoRoot: string, hooksDir: string): boolean {
  const installed = path.join(repoRoot, HOOK_RELATIVE_PATH);
  const source = path.join(hooksDir, "codex-continue-on-stop.sh");
  if (!fs.existsSync(installed) || path.resolve(installed) === path.resolve(source)) return false;
  const current = fs.readFileSync(installed, "utf8");
  if (!current.includes(RECOGNIZED_HOOK_LINE) || current === fs.readFileSync(source, "utf8")) return false;
  fs.copyFileSync(source, installed);
  fs.chmodSync(installed, 0o755);
  return true;
}

/** Whether the hook is installed in the project's repository and currently on. */
export function continueHookStatus(projectPath: string): { installed: boolean; enabled: boolean } {
  const repoRoot = resolveRepoRoot(projectPath);
  const installed = fs.existsSync(path.join(repoRoot, HOOK_RELATIVE_PATH));
  return { installed, enabled: installed && !isDisabled(repoRoot) };
}

export function enableContinueHook(projectPath: string, agent?: string, hooksDir = HOOKS_DIR): string {
  const repoRoot = resolveRepoRoot(projectPath);
  // Clear the flag first: the installer's smoke test expects the hook to block.
  clearFlags(repoRoot);

  if (agent !== undefined) {
    if (!(CONTINUE_HOOK_AGENTS as readonly string[]).includes(agent)) {
      throw new Error(`agent must be one of ${CONTINUE_HOOK_AGENTS.join(", ")}`);
    }
    execFileSync(path.join(hooksDir, "install.sh"), ["--target", repoRoot, "--agent", agent], { encoding: "utf8" });
    const log = startProgressLog(repoRoot);
    return `Installed (idempotent) and enabled the Aimparency continuation hook for ${agent} in ${repoRoot}; progress is logged to ${log}. If the ${agent} session was already running before a first install, reload its hooks (Claude: /hooks; Codex: restart and trust).`;
  }

  if (!fs.existsSync(path.join(repoRoot, HOOK_RELATIVE_PATH))) {
    throw new Error(`No continuation hook installed in ${repoRoot}; pass agent (${CONTINUE_HOOK_AGENTS.join("|")}) to install it.`);
  }
  const upgraded = upgradeRecognizedHook(repoRoot, hooksDir);
  const log = startProgressLog(repoRoot);
  return `Enabled the Aimparency continuation hook in ${repoRoot}${upgraded ? " (upgraded its outdated script)" : ""}; progress is logged to ${log}. It applies from the next Stop.`;
}

export function disableContinueHook(projectPath: string, hooksDir = HOOKS_DIR): string {
  const repoRoot = resolveRepoRoot(projectPath);
  const notes: string[] = [];

  // Copies installed before the off switch existed never check the flag; upgrade
  // a recognized Aimparency script in place (config untouched) so disabling works.
  if (upgradeRecognizedHook(repoRoot, hooksDir)) notes.push("upgraded the installed hook script so it honors the off switch");

  closeProgressLog(repoRoot);
  clearFlags(repoRoot);
  fs.mkdirSync(path.dirname(disabledFlagPath(repoRoot)), { recursive: true });
  fs.writeFileSync(disabledFlagPath(repoRoot), `disabled ${new Date().toISOString()}\n`);
  return `Disabled the Aimparency continuation hook in ${repoRoot}; agents may stop normally from the next Stop.${notes.length ? ` Also ${notes.join("; ")}.` : ""}`;
}
