// The address of a graph on the Aimparency server that hosts it:
// <origin>/g/<slug>, the same URL a person opens in the browser. A link to
// another graph stores it, so following the link needs no checkout and no
// path on this machine. Whoever follows a link (the browser, an MCP client)
// talks to that server itself; the server of the linking graph never fetches
// foreign graphs.

import { isGraphSlug } from './project-path.js';
import { IdeaSchema, type Idea } from './types.js';

export type GraphHost = { origin: string; slug: string };

/** Reads `https://hub.example.org/g/commons-hub` (trailing slash, query and hash ignored); null when it is no graph address. */
export function parseGraphHost(address: string): GraphHost | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const match = /^\/g\/([^/]+)\/?$/.exec(url.pathname);
  if (!match || !isGraphSlug(match[1]!)) return null;
  return { origin: url.origin, slug: match[1]! };
}

export function graphHostUrl(host: GraphHost): string {
  return `${host.origin}/g/${host.slug}`;
}

/** What a server says about one of its graphs: enough to store a link to it. */
export type GraphAtHost = { host: string; repoId: string; name: string };

// One read query of the hosting server's API, as any visitor's page makes it.
async function queryAtHost(address: string, procedure: string, fetchImpl: typeof fetch): Promise<{ host: GraphHost; data: unknown }> {
  const host = parseGraphHost(address);
  if (!host) throw new Error(`"${address}" is not the address of a graph; it looks like https://<server>/g/<graph>.`);
  const input = encodeURIComponent(JSON.stringify({ graph: host.slug }));
  let response: Response;
  try {
    response = await fetchImpl(`${host.origin}/trpc/${procedure}?input=${input}`);
  } catch {
    throw new Error(`${host.origin} cannot be reached.`);
  }
  if (!response.ok) throw new Error(`${host.origin} has no graph "${host.slug}" to show (HTTP ${response.status}).`);
  return { host, data: (await response.json() as { result?: { data?: unknown } }).result?.data };
}

/** Asks the server hosting the graph for its identity and name, through its public API. */
export async function fetchGraphAtHost(address: string, fetchImpl: typeof fetch = fetch): Promise<GraphAtHost> {
  const { host, data } = await queryAtHost(address, 'project.getMeta', fetchImpl);
  const meta = data as { repoId?: unknown; name?: unknown } | undefined;
  if (typeof meta?.repoId !== 'string') throw new Error(`${host.origin} did not name graph "${host.slug}".`);
  return { host: graphHostUrl(host), repoId: meta.repoId, name: typeof meta.name === 'string' ? meta.name : host.slug };
}

/** The ideas of the graph at its host; ideas that do not parse are left out. */
export async function fetchIdeasAtHost(address: string, fetchImpl: typeof fetch = fetch): Promise<Idea[]> {
  const { host, data } = await queryAtHost(address, 'project.loadIdeas', fetchImpl);
  const ideas = (data as { ideas?: unknown } | undefined)?.ideas;
  if (!Array.isArray(ideas)) throw new Error(`${host.origin} sent no ideas for graph "${host.slug}".`);
  return ideas.flatMap((idea) => {
    const parsed = IdeaSchema.safeParse(idea);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The value a linked graph receives, spread over its ideas. The inflow takes
 * the place of the graph's whole intrinsic value: shared out in proportion to
 * its intrinsic values, then flowing along its own connections. The graph's
 * own values (calculateIdeaValues) are normalized to a total intrinsic of 1,
 * so each idea holds inflow × its own value.
 */
export function spreadInflow(inflow: number, ownValues: Map<string, number>): Map<string, number> {
  return new Map([...ownValues].map(([id, value]) => [id, value * inflow]));
}
