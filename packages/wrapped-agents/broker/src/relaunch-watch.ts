import path from 'path';
import fs from 'fs-extra';
import { AIMPARENCY_DIR_NAME } from 'shared';
// Type-only import: keeps this module free of manager.ts's heavy runtime deps
// (node-pty, express) and avoids a runtime import cycle.
import type { AgentType } from './manager.js';

/**
 * Broker side of the self-rebuild chain (aim 5af61b3e): detect (4a96fff0) → warn
 * (310878de) → the worker commits and drops a relaunch INDICATOR FILE → the broker
 * here finds it and rebuilds+relaunches the session (this aim, 29021d9a).
 *
 * Indicator contract: a file at `<project .bowman>/runtime/relaunch-request`
 * (the gitignored runtime dir). Presence alone requests a verified relaunch;
 * optional JSON body `{ "verify": false }` forces an unverified relaunch (e.g.
 * an operator recovering from already-red tests). The watcher CONSUMES (deletes)
 * the file before relaunching so a failing or overlapping pass can't loop.
 *
 * "Rebuild" is implicit: sessions run from source via tsx, so a process restart
 * loads the new code; relaunch() gates that on a typecheck+test verify pass.
 */

const RUNTIME_DIR_NAME = 'runtime';
const RELAUNCH_REQUEST_FILE = 'relaunch-request';

// Mirrors WatchdogManager.normalizeProjectPath (kept local to avoid a cycle).
function normalizeProjectPath(p: string): string {
  if (!p) return p;
  const clean = p.replace(/[\\/]$/, '');
  if (clean.endsWith(AIMPARENCY_DIR_NAME)) return clean;
  return path.join(clean, AIMPARENCY_DIR_NAME);
}

export function getProjectRelaunchRequestFile(projectPath: string): string {
  return path.join(normalizeProjectPath(projectPath), RUNTIME_DIR_NAME, RELAUNCH_REQUEST_FILE);
}

export interface RelaunchRequest {
  requested: boolean;
  verify?: boolean;
}

/**
 * Read and DELETE the relaunch indicator for a project. Returns whether a
 * relaunch was requested (and the optional verify override). Deleting up front
 * makes the request one-shot.
 */
export function consumeRelaunchRequest(projectPath: string): RelaunchRequest {
  const file = getProjectRelaunchRequestFile(projectPath);
  if (!fs.existsSync(file)) return { requested: false };

  let verify: boolean | undefined;
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.verify === 'boolean') verify = parsed.verify;
    }
  } catch {
    // Empty or non-JSON indicator: presence alone still requests a (verified) relaunch.
  }

  try {
    fs.removeSync(file);
  } catch {
    // Best-effort: if we can't delete it the next pass may retry, which is safe
    // (relaunch is idempotent enough — it restarts a session).
  }

  return { requested: true, verify };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface RelaunchPassDeps {
  /** Currently-live sessions (already-normalized projectPath + agentType). */
  instances: Array<{ projectPath: string; agentType: AgentType }>;
  /** The real WatchdogManager.relaunch; injected so the pass is testable. */
  relaunch: (projectPath: string, agentType: AgentType, opts: { verify?: boolean }) => Promise<unknown>;
  consume?: (projectPath: string) => RelaunchRequest;
  log?: (msg: string) => void;
}

/**
 * One scan: for each project with a relaunch indicator, relaunch every live
 * session of that project. Relaunches are awaited sequentially and each is
 * isolated in try/catch — a failed verify/build keeps that session on its
 * current code and never breaks the pass or the broker.
 */
export async function runRelaunchPass(deps: RelaunchPassDeps): Promise<void> {
  const consume = deps.consume ?? consumeRelaunchRequest;
  const log = deps.log ?? ((m: string) => console.log(m));

  // The indicator is per-project (its runtime dir); a self-edit is global, so
  // relaunch every agent session of a project once its indicator appears.
  const byProject = new Map<string, AgentType[]>();
  for (const inst of deps.instances) {
    const list = byProject.get(inst.projectPath) ?? [];
    list.push(inst.agentType);
    byProject.set(inst.projectPath, list);
  }

  for (const [projectPath, agentTypes] of byProject) {
    let req: RelaunchRequest;
    try {
      req = consume(projectPath);
    } catch (e) {
      log(`[WatchdogBroker] Failed reading relaunch indicator for ${projectPath}: ${errMsg(e)}`);
      continue;
    }
    if (!req.requested) continue;

    for (const agentType of agentTypes) {
      try {
        log(`[WatchdogBroker] Relaunch indicator found — rebuilding+relaunching ${agentType}@${projectPath}.`);
        await deps.relaunch(projectPath, agentType, { verify: req.verify });
        log(`[WatchdogBroker] Relaunch complete for ${agentType}@${projectPath}.`);
      } catch (e) {
        log(`[WatchdogBroker] Relaunch FAILED for ${agentType}@${projectPath}: ${errMsg(e)} — session keeps running current code.`);
      }
    }
  }
}
