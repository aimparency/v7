// How a request names its space. Every procedure takes `space`; its value is a
// space address: the slug of a space of this server, or, only on a server
// without login, a directory on this machine. On a server with accounts a path
// is never accepted: where spaces live is the operator's business, and nobody
// reaches a directory that is not on the list.

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { hasAccounts } from 'shared/server-config';
import { isSpaceSlug } from 'shared';
import { findSpace, findSpaceByPath, spaceBowmanPath, type Space } from './registry.js';

export type ResolvedSpace = {
  /** What handlers work with: the space's .bowman, or the path as it was given. */
  path: string;
  /** The space's entry in the server's list; null for a directory that is not listed. */
  space: Space | null;
};

export function resolveSpaceAddress(address: string): ResolvedSpace {
  if (isSpaceSlug(address)) {
    const space = findSpace(address);
    if (!space) throw new TRPCError({ code: 'NOT_FOUND', message: `No space "${address}" on this server.` });
    return { path: spaceBowmanPath(space), space };
  }
  if (hasAccounts()) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Spaces on this server are addressed by their name, not by a path.' });
  }
  return { path: address, space: findSpaceByPath(address) };
}

/** The `space` of a procedure's input: handlers receive the directory. */
export const spaceAddress = z.string().transform(address => resolveSpaceAddress(address).path);
