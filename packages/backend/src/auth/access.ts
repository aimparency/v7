// What a hosted instance lets each role do. Locally (no AIMPARENCY_HOSTED) the
// one person at the machine may do everything; hosted, one project is served,
// reading is open to anyone, and writing needs an account.

import { TRPCError } from '@trpc/server';
import { normalizeProjectPath } from '../project-path.js';
import { resolveToken, roleAtLeast, type Role } from './accounts.js';

type Need = Role | 'local';

export function hostedProject(): string | null {
  const project = process.env.AIMPARENCY_PROJECT;
  return process.env.AIMPARENCY_HOSTED === 'true' && project ? normalizeProjectPath(project) : null;
}

// Agents, loops and server paths: things a shared server must not hand out.
const LOCAL_ONLY_ROUTERS = new Set(['loop', 'watchdog', 'system', 'voice', 'market', 'spinOff']);
const LOCAL_ONLY = new Set([
  'project.openGitUrl', 'project.discoverLocalProjects', 'project.inspectPath', 'project.injectAgentInstructions'
]);
// Derived state, nothing checked in; or a viewer's own login.
const READ_MUTATIONS = new Set([
  'project.buildSearchIndex', 'phase.setCursor', 'auth.login', 'auth.logout', 'auth.issueToken', 'auth.changeOwnPassword'
]);
const WRITE_ROUTERS = new Set(['idea', 'phase']);
const WRITE_MUTATIONS = new Set(['history.restore', 'graphHealth.fixConsistency']);
// Every other mutation needs an admin, so a new one is closed until listed.

export function neededRole(path: string, type: string): Need {
  const router = path.split('.')[0]!;
  if (LOCAL_ONLY_ROUTERS.has(router) || LOCAL_ONLY.has(path)) return 'local';
  if (type !== 'mutation') return path.startsWith('auth.') && path !== 'auth.me' ? 'admin' : 'read';
  if (READ_MUTATIONS.has(path)) return 'read';
  if (WRITE_ROUTERS.has(router) || WRITE_MUTATIONS.has(path)) return 'write';
  return 'admin';
}

export type Viewer = { name: string | null; role: Role };

export async function viewerFor(token: string | undefined): Promise<Viewer> {
  const project = hostedProject();
  if (!project) return { name: null, role: 'admin' };
  const user = await resolveToken(project, token);
  return user ?? { name: null, role: 'read' };
}

// The message of a refused write keeps "open read-only", which the UI already
// recognises as "editing is off here".
export function assertAllowed(path: string, type: string, viewer: Viewer, input: unknown) {
  const project = hostedProject();
  if (!project) return;
  const need = neededRole(path, type);
  if (need === 'local') {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${path} is not available on a hosted instance.` });
  }
  const projectPath = (input as { projectPath?: unknown } | undefined)?.projectPath;
  if (typeof projectPath === 'string' && normalizeProjectPath(projectPath) !== project) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This instance serves one project only.' });
  }
  if (!roleAtLeast(viewer.role, need)) {
    const message = viewer.name
      ? `This project is open read-only for ${viewer.name}: ${need === 'admin' ? 'admins only' : 'ask an admin for write access'}.`
      : 'This project is open read-only here: log in to edit.';
    throw new TRPCError({ code: 'FORBIDDEN', message });
  }
}
