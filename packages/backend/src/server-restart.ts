// A server admin restarts the server from the UI, or pulls main, builds and
// restarts it. Only where something starts it again:
// - a supervisor (AIMPARENCY_SUPERVISED, e.g. a systemd unit with
//   Restart=on-failure): the backend exits with RESTART_EXIT_CODE,
//   scripts/run-local-stack.mjs stops the rest of the stack and exits with it,
//   and the supervisor starts it anew;
// - the local stack itself (`pnpm dev`, `pnpm start` without accounts; it
//   passes its pid as AIMPARENCY_STACK_PID): the backend signals it, and it
//   stops every process of the stack and starts them again. This also works
//   under `tsx watch`, which would only wait for changes after an exit.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TRPCError } from '@trpc/server';
import { runsFromSource } from 'shared/node-entry';

const run = promisify(execFile);
export const RESTART_EXIT_CODE = 75;
/** What the local stack restarts on (scripts/run-local-stack.mjs). */
export const RESTART_SIGNAL = 'SIGUSR2';

const stackPid = () => Number(process.env.AIMPARENCY_STACK_PID) || undefined;

export const restartable = () => process.env.AIMPARENCY_SUPERVISED === 'true' || stackPid() !== undefined;

let busy = false;

function assertRestartable() {
  if (!restartable()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nothing would start this server again: it restarts only under a supervisor (AIMPARENCY_SUPERVISED=true) or the local stack (pnpm dev, pnpm start).' });
  if (busy) throw new TRPCError({ code: 'CONFLICT', message: 'A restart is already under way.' });
}

// After the answer has left: the stack or the supervisor starts the server again.
function exitSoon() {
  const pid = stackPid();
  console.log(pid ? '[server] restarting: asking the local stack' : '[server] restarting: exiting for the supervisor');
  setTimeout(() => {
    if (pid) process.kill(pid, RESTART_SIGNAL);
    else process.exit(RESTART_EXIT_CODE);
    // Handed off; should nothing stop this process, a later restart may try again.
    busy = false;
  }, 500).unref?.();
}

export function restartServer(): { restarting: true } {
  assertRestartable();
  busy = true;
  exitSoon();
  return { restarting: true };
}

const tail = (text: string, lines = 30) => text.trim().split('\n').slice(-lines).join('\n');

// git pull --ff-only origin main, then (when something came) install and, for
// a built stack, build what it runs, then restart. From source (`pnpm dev`)
// nothing needs building. Anything failing leaves the running server
// as it is and says why.
export async function updateServer(): Promise<{ restarting: true; before: string; after: string; commits: string[] }> {
  assertRestartable();
  busy = true;
  try {
    const git = (...args: string[]) => run('git', args, { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }).then(result => result.stdout.trim());
    const root = await git('rev-parse', '--show-toplevel');
    const inRoot = (command: string, args: string[]) => run(command, args, { cwd: root, maxBuffer: 64 * 1024 * 1024, env: process.env });
    const before = await git('rev-parse', 'HEAD');
    await inRoot('git', ['pull', '--ff-only', 'origin', 'main']);
    const after = await git('rev-parse', 'HEAD');
    const commits = before === after ? [] : (await git('log', '--format=%h %s', `${before}..${after}`)).split('\n').filter(Boolean);
    if (before !== after) {
      await inRoot('pnpm', ['install', '--frozen-lockfile']);
      if (!runsFromSource(import.meta.url)) {
        await inRoot('pnpm', ['run', 'build:core']);
        await inRoot('pnpm', ['--filter', 'mcp', 'build']);
      }
    }
    exitSoon();
    return { restarting: true, before: before.slice(0, 8), after: after.slice(0, 8), commits };
  } catch (error) {
    busy = false;
    const failed = error as { stderr?: string; stdout?: string; message?: string };
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Not restarted, the server runs on as it was:\n${tail(failed.stderr || failed.stdout || failed.message || String(error))}` });
  }
}
