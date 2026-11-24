// The address of a space on the Aimparency server that hosts it:
// <origin>/spaces/<slug>, the same URL a person opens in the browser. A link to
// another space stores it, so following the link needs no checkout and no
// path on this machine. Whoever follows a link (the browser, an MCP client)
// talks to that server itself; the server of the linking space never fetches
// foreign spaces.

import { isSpaceSlug } from './project-path.js';
import { IdeaSchema, type Idea } from './types.js';

export type SpaceHost = { origin: string; slug: string };

/** Reads `https://hub.example.org/spaces/commons-hub` (trailing slash, query and hash ignored); null when it is no space address. */
export function parseSpaceHost(address: string): SpaceHost | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const match = /^\/spaces\/([^/]+)\/?$/.exec(url.pathname);
  if (!match || !isSpaceSlug(match[1]!)) return null;
  return { origin: url.origin, slug: match[1]! };
}

export function spaceHostUrl(host: SpaceHost): string {
  return `${host.origin}/spaces/${host.slug}`;
}

/** What a server says about one of its spaces: enough to store a link to it, and its color. */
export type SpaceAtHost = { host: string; repoId: string; name: string; color?: string };

// One read query of the hosting server's API, as any visitor's page makes it.
async function queryAtHost(address: string, procedure: string, fetchImpl: typeof fetch): Promise<{ host: SpaceHost; data: unknown }> {
  const host = parseSpaceHost(address);
  if (!host) throw new Error(`"${address}" is not the address of a space; it looks like https://<server>/spaces/<space>.`);
  const input = encodeURIComponent(JSON.stringify({ space: host.slug }));
  let response: Response;
  try {
    response = await fetchImpl(`${host.origin}/trpc/${procedure}?input=${input}`);
  } catch {
    throw new Error(`${host.origin} cannot be reached.`);
  }
  if (!response.ok) throw new Error(`${host.origin} has no space "${host.slug}" to show (HTTP ${response.status}).`);
  return { host, data: (await response.json() as { result?: { data?: unknown } }).result?.data };
}

/** Asks the server hosting the space for its identity and name, through its public API. */
export async function fetchSpaceAtHost(address: string, fetchImpl: typeof fetch = fetch): Promise<SpaceAtHost> {
  const { host, data } = await queryAtHost(address, 'project.getMeta', fetchImpl);
  const meta = data as { repoId?: unknown; name?: unknown; color?: unknown } | undefined;
  if (typeof meta?.repoId !== 'string') throw new Error(`${host.origin} did not name space "${host.slug}".`);
  return {
    host: spaceHostUrl(host),
    repoId: meta.repoId,
    name: typeof meta.name === 'string' ? meta.name : host.slug,
    ...(typeof meta.color === 'string' ? { color: meta.color } : {})
  };
}

/** The ideas of the space at its host; ideas that do not parse are left out. */
export async function fetchIdeasAtHost(address: string, fetchImpl: typeof fetch = fetch): Promise<Idea[]> {
  const { host, data } = await queryAtHost(address, 'project.loadIdeas', fetchImpl);
  const ideas = (data as { ideas?: unknown } | undefined)?.ideas;
  if (!Array.isArray(ideas)) throw new Error(`${host.origin} sent no ideas for space "${host.slug}".`);
  return ideas.flatMap((idea) => {
    const parsed = IdeaSchema.safeParse(idea);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The value a linked space receives, spread over its ideas. The inflow takes
 * the place of the space's whole intrinsic value: shared out in proportion to
 * its intrinsic values, then flowing along its own connections. The space's
 * own values (calculateIdeaValues) are normalized to a total intrinsic of 1,
 * so each idea holds inflow × its own value.
 */
export function spreadInflow(inflow: number, ownValues: Map<string, number>): Map<string, number> {
  return new Map([...ownValues].map(([id, value]) => [id, value * inflow]));
}

/**
 * Where the inflow enters a linked space: its ideas with intrinsic value, each
 * taking its share of the space's whole intrinsic value. A space without any
 * intrinsic value takes it in at its top ideas, equally.
 */
export function intrinsicShares(ideas: Idea[]): Array<[string, number]> {
  const valued = ideas.filter((idea) => (idea.intrinsicValue ?? 0) > 0);
  const total = valued.reduce((sum, idea) => sum + idea.intrinsicValue!, 0);
  if (total > 0) return valued.map((idea) => [idea.id, idea.intrinsicValue! / total]);
  const ids = new Set(ideas.map((idea) => idea.id));
  const tops = ideas.filter((idea) => !idea.supportedIdeas.some((parent) => ids.has(parent)));
  return tops.map((idea) => [idea.id, 1 / tops.length]);
}
