import type { BackendClient } from "../client.js";

// Ideas and phases may be named by the beginning of their id ("1f6f2c46"), as
// lists and commit messages show them. Before a tool runs, every such
// beginning becomes the one id it begins with; none or several fail, naming
// what was found, so no call ever lands on a guessed idea.

const FULL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = /^[0-9a-f]{4,}[0-9a-f-]*$/i;

// Where arguments name ideas or phases: `id`, `…Id` and `…Ids`, and the
// entries of link lists (addSupportedIdeas, removeSupportingConnections, …),
// which are ids or objects with `ideaId`; siblingShares is keyed by ids.
const isIdKey = (key: string) => key === "id" || /Id$/.test(key);
const isIdListKey = (key: string) => /(Ids|Ideas|Connections)$/.test(key);
const isPrefix = (value: unknown): value is string => typeof value === "string" && !FULL_ID.test(value) && PREFIX.test(value) && value.length < 36;

type Visit = (value: string) => string;

function walk(value: unknown, key: string, visit: Visit): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => (isIdListKey(key) && isPrefix(entry) ? visit(entry) : walk(entry, "", visit)));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([field, entry]) => {
      const name = key === "siblingShares" && isPrefix(field) ? visit(field) : field;
      return [name, isIdKey(field) && isPrefix(entry) ? visit(entry) : walk(entry, field, visit)] as const;
    });
    return Object.fromEntries(entries);
  }
  return value;
}

export class IdPrefixError extends Error {}

/** The arguments with every id beginning replaced by the full id; throws when one matches no id or several. */
export async function expandIdPrefixes<T extends Record<string, unknown>>(args: T, client: Pick<BackendClient, "space">): Promise<T> {
  const found = new Set<string>();
  walk(args, "", (value) => { found.add(value); return value; });
  if (found.size === 0 || typeof args.space !== "string") return args;
  const matches = await client.space.idsBeginningWith.query({ space: args.space, prefixes: [...found] });
  for (const prefix of found) {
    const ids = matches[prefix] ?? [];
    if (ids.length === 0) throw new IdPrefixError(`No idea or phase id begins with "${prefix}".`);
    if (ids.length > 1) {
      throw new IdPrefixError(`"${prefix}" is the beginning of several ids: ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", …" : ""}. Give more of it.`);
    }
  }
  return walk(args, "", (value) => matches[value]![0]!) as T;
}
