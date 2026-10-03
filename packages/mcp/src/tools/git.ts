import { execFileSync } from "child_process";
import * as path from "path";

// --- Realized-cost signal (c0a45822: reality→priority feedback) ---------------
// Real git commits that reference an idea are evidence of actual output. Counting
// them grounds the COST side of priority in reality WITHOUT mutating the
// human-set intrinsicValue/cost (the chosen, non-corrupting design). Heuristic:
// a commit "references" an idea when its message contains the idea's 8-char id
// prefix — the convention used in this repo's commit messages.

// Best-effort: one commit message per element (subject+body). Returns [] when the
// project isn't a git repo or git is unavailable, so the signal degrades
// gracefully and never breaks prioritization.
// `pathspec` (git pathspec args, e.g. ['--', '.', ':(exclude).bowman']) restricts
// to commits that touched matching files. Reconciliation passes a code-only
// pathspec so pure graph-bookkeeping commits (chore(graph)/chore(bowman) that
// merely cite idea ids while triaging/reframing the graph) don't masquerade as
// "this idea was implemented" — they touch only .bowman/.
export function getRepoCommitMessages(projectPath: string, maxCommits = 2000, pathspec: string[] = []): string[] {
  try {
    const repoRoot = path.basename(projectPath) === ".bowman" ? path.dirname(projectPath) : projectPath;
    const out = execFileSync(
      "git",
      ["log", `-${maxCommits}`, "--format=%s%n%b%n--END-COMMIT--", ...pathspec],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 }
    );
    return out.split("--END-COMMIT--").filter((m) => m.trim().length > 0);
  } catch {
    return [];
  }
}

// Commits that changed at least one file outside .bowman/ — i.e. real code work,
// not graph metadata edits. The basis for the reconciliation signal.
export const CODE_ONLY_PATHSPEC = ["--", ".", ":(exclude).bowman"];

// True if `token` (fixed string) appears in any tracked code file outside
// .bowman/. git grep exits 0 on a match, 1 on none (execFileSync throws) — the
// catch covers "no match" and "not a git repo" alike. Used by the code-presence
// reconciliation heuristic.
export function gitGrepMatches(projectPath: string, token: string): boolean {
  try {
    const repoRoot = path.basename(projectPath) === ".bowman" ? path.dirname(projectPath) : projectPath;
    execFileSync(
      "git",
      ["grep", "-F", "-I", "-l", "-e", token, "--", ".", ":(exclude).bowman"],
      { cwd: repoRoot, stdio: ["ignore", "ignore", "ignore"], maxBuffer: 8 * 1024 * 1024 }
    );
    return true;
  } catch {
    return false;
  }
}
