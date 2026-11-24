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
const DEFAULT_LOOP_FILE = "default-loop.md";
// Hook loops: what the hook tells the agent. Saved ones are versioned with the
// space; which one runs is machine-local, like the off switch.
const LOOPS_DIR = path.join(".bowman", "hook-loops");
const ACTIVE_LOOP = path.join(".bowman", "runtime", "continue-hook-loop");
// Where the default loop is read from: this checkout's default-loop.md, so the
// default follows Aimparency updates instead of a copy frozen at install.
const LIVE_DEFAULT = path.join(".bowman", "runtime", "continue-hook-default");
const HUMAN_HEADING = "## When the agent asks for the human";
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
// recognized but outdated copy in another repository up to date, with the
// default loop text it falls back to, and point it at the live default.
function upgradeRecognizedHook(repoRoot: string, hooksDir: string): boolean {
  const installed = path.join(repoRoot, HOOK_RELATIVE_PATH);
  const source = path.join(hooksDir, "codex-continue-on-stop.sh");
  if (!fs.existsSync(installed) || path.resolve(installed) === path.resolve(source)) return false;
  const current = fs.readFileSync(installed, "utf8");
  if (!current.includes(RECOGNIZED_HOOK_LINE)) return false;
  fs.mkdirSync(path.join(repoRoot, path.dirname(LIVE_DEFAULT)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, LIVE_DEFAULT), `${path.join(hooksDir, DEFAULT_LOOP_FILE)}\n`);
  const defaultCopy = path.join(path.dirname(installed), DEFAULT_LOOP_FILE);
  const defaultSource = path.join(hooksDir, DEFAULT_LOOP_FILE);
  const defaultOutdated = !fs.existsSync(defaultCopy) || fs.readFileSync(defaultCopy, "utf8") !== fs.readFileSync(defaultSource, "utf8");
  if (defaultOutdated) fs.copyFileSync(defaultSource, defaultCopy);
  if (current === fs.readFileSync(source, "utf8")) return defaultOutdated;
  fs.copyFileSync(source, installed);
  fs.chmodSync(installed, 0o755);
  return true;
}

export type ContinueHookStatus = {
  installed: boolean;
  enabled: boolean;
  /** Slug of the hook loop that runs; null for the default. */
  loop: string | null;
};

/** Whether the hook is installed in the project's repository, on, and which loop it runs. */
export function continueHookStatus(projectPath: string): ContinueHookStatus {
  const repoRoot = resolveRepoRoot(projectPath);
  const installed = fs.existsSync(path.join(repoRoot, HOOK_RELATIVE_PATH));
  return { installed, enabled: installed && !isDisabled(repoRoot), loop: activeLoop(repoRoot) };
}

// ---- Hook loops ------------------------------------------------------------
// A loop file is "# Title", the work text, and optionally a human section with
// the challenge the agent gets before it may wait for the human. The default
// lives next to the hook script; it can be read and saved as a new loop, never
// overwritten.

export const DEFAULT_LOOP = "default";

export type HookLoop = { slug: string; title: string; work: string; human: string };

const isLoopSlug = (slug: string) => /^[a-z0-9-]+$/.test(slug) && slug !== DEFAULT_LOOP;
const loopsDir = (repoRoot: string) => path.join(repoRoot, LOOPS_DIR);
const loopFile = (repoRoot: string, slug: string) => {
  if (!isLoopSlug(slug)) throw new Error(`Not a hook loop: ${slug}`);
  return path.join(loopsDir(repoRoot), `${slug}.md`);
};

export function parseHookLoop(slug: string, text: string): HookLoop {
  const title = /^# (.*)$/m.exec(text)?.[1]?.trim() || slug;
  const body = text.replace(/^# .*\n/, "");
  const at = body.indexOf(HUMAN_HEADING);
  const work = (at === -1 ? body : body.slice(0, at)).trim();
  const human = at === -1 ? "" : body.slice(at + HUMAN_HEADING.length).trim();
  return { slug, title, work, human };
}

export function serializeHookLoop(loop: Pick<HookLoop, "title" | "work" | "human">): string {
  const human = loop.human.trim() ? `\n${HUMAN_HEADING}\n\n${loop.human.trim()}\n` : "";
  return `# ${loop.title.trim()}\n\n${loop.work.trim()}\n${human}`;
}

export function defaultHookLoop(hooksDir = HOOKS_DIR): HookLoop {
  return parseHookLoop(DEFAULT_LOOP, fs.readFileSync(path.join(hooksDir, DEFAULT_LOOP_FILE), "utf8"));
}

/** The default first, then the space's saved loops by title. */
export function listHookLoops(projectPath: string, hooksDir = HOOKS_DIR): HookLoop[] {
  const repoRoot = resolveRepoRoot(projectPath);
  const dir = loopsDir(repoRoot);
  const saved = fs.existsSync(dir)
    ? fs.readdirSync(dir)
        .filter(name => name.endsWith(".md") && isLoopSlug(name.slice(0, -3)))
        .map(name => parseHookLoop(name.slice(0, -3), fs.readFileSync(path.join(dir, name), "utf8")))
        .sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug))
    : [];
  return [defaultHookLoop(hooksDir), ...saved];
}

const slugify = (title: string) =>
  title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "loop";

/** Saves a loop; without slug (or with the default's) it becomes a new one. Returns its slug. */
export function saveHookLoop(projectPath: string, loop: { slug?: string; title: string; work: string; human: string }): string {
  if (!loop.title.trim()) throw new Error("A hook loop needs a title.");
  if (!loop.work.trim()) throw new Error("A hook loop needs a text for the agent.");
  const repoRoot = resolveRepoRoot(projectPath);
  let slug = loop.slug && loop.slug !== DEFAULT_LOOP ? loop.slug : "";
  if (!slug) {
    const base = slugify(loop.title) === DEFAULT_LOOP ? "default-copy" : slugify(loop.title);
    slug = base;
    for (let n = 2; fs.existsSync(loopFile(repoRoot, slug)); n++) slug = `${base}-${n}`;
  }
  fs.mkdirSync(loopsDir(repoRoot), { recursive: true });
  fs.writeFileSync(loopFile(repoRoot, slug), serializeHookLoop(loop));
  return slug;
}

/** Deletes a saved loop; if it was running, the default takes over. */
export function deleteHookLoop(projectPath: string, slug: string): void {
  const repoRoot = resolveRepoRoot(projectPath);
  fs.rmSync(loopFile(repoRoot, slug), { force: true });
  if (activeLoop(repoRoot) === slug) fs.rmSync(path.join(repoRoot, ACTIVE_LOOP), { force: true });
}

function activeLoop(repoRoot: string): string | null {
  const pointer = path.join(repoRoot, ACTIVE_LOOP);
  if (!fs.existsSync(pointer)) return null;
  const slug = fs.readFileSync(pointer, "utf8").trim();
  return isLoopSlug(slug) && fs.existsSync(loopFile(repoRoot, slug)) ? slug : null;
}

function selectLoop(repoRoot: string, slug: string | null): void {
  const pointer = path.join(repoRoot, ACTIVE_LOOP);
  if (slug === null || slug === DEFAULT_LOOP) return fs.rmSync(pointer, { force: true });
  if (!fs.existsSync(loopFile(repoRoot, slug))) throw new Error(`No hook loop "${slug}" in ${repoRoot}.`);
  fs.mkdirSync(path.dirname(pointer), { recursive: true });
  fs.writeFileSync(pointer, `${slug}\n`);
}

export type EnableContinueHookOptions = {
  /** Install (idempotently) for this coding assistant first. */
  agent?: string;
  /** "default" or a saved loop's slug; omitted keeps the loop chosen last. */
  loop?: string;
  hooksDir?: string;
};

export function enableContinueHook(projectPath: string, { agent, loop, hooksDir = HOOKS_DIR }: EnableContinueHookOptions = {}): string {
  const repoRoot = resolveRepoRoot(projectPath);
  const installed = fs.existsSync(path.join(repoRoot, HOOK_RELATIVE_PATH));
  if (agent !== undefined && !(CONTINUE_HOOK_AGENTS as readonly string[]).includes(agent)) {
    throw new Error(`agent must be one of ${CONTINUE_HOOK_AGENTS.join(", ")}`);
  }
  if (agent === undefined && !installed) {
    throw new Error(`No continuation hook installed in ${repoRoot}; pass agent (${CONTINUE_HOOK_AGENTS.join("|")}) to install it.`);
  }
  const wasEnabled = installed && !isDisabled(repoRoot);
  if (loop !== undefined) selectLoop(repoRoot, loop);
  const running = `loop "${activeLoop(repoRoot) ?? DEFAULT_LOOP}"`;

  // Already on: switching the loop continues the same run and its log.
  if (wasEnabled && agent === undefined) {
    const upgraded = upgradeRecognizedHook(repoRoot, hooksDir);
    const log = currentProgressLog(repoRoot);
    if (log && fs.existsSync(log)) fs.appendFileSync(log, `\nSwitched to ${running} ${new Date().toISOString()}.\n\n`);
    return `The Aimparency continuation hook in ${repoRoot} runs ${running}${upgraded ? " (upgraded its outdated script)" : ""}. It applies from the next Stop.`;
  }

  // Clear the flag first: the installer's smoke test expects the hook to block.
  clearFlags(repoRoot);
  if (agent !== undefined) {
    execFileSync(path.join(hooksDir, "install.sh"), ["--target", repoRoot, "--agent", agent], { encoding: "utf8" });
    const log = startProgressLog(repoRoot);
    return `Installed (idempotent) and enabled the Aimparency continuation hook for ${agent} in ${repoRoot}, running ${running}; progress is logged to ${log}. If the ${agent} session was already running before a first install, reload its hooks (Claude: /hooks; Codex: restart and trust).`;
  }
  const upgraded = upgradeRecognizedHook(repoRoot, hooksDir);
  const log = startProgressLog(repoRoot);
  return `Enabled the Aimparency continuation hook in ${repoRoot}, running ${running}${upgraded ? " (upgraded its outdated script)" : ""}; progress is logged to ${log}. It applies from the next Stop.`;
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
