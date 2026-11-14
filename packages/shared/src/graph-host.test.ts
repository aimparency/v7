import { test } from 'node:test';
import assert from 'node:assert';
import { fetchGraphAtHost, fetchIdeasAtHost, parseGraphHost, spreadInflow } from './graph-host.js';

test('a graph address is the origin and the slug of the page URL', () => {
  assert.deepStrictEqual(parseGraphHost(' https://hub.example.org/g/commons-hub/?x=1#top '), { origin: 'https://hub.example.org', slug: 'commons-hub' });
  assert.deepStrictEqual(parseGraphHost('http://localhost:4100/g/v7'), { origin: 'http://localhost:4100', slug: 'v7' });
  for (const notAGraph of ['hub.example.org/g/x', 'https://hub.example.org/', 'https://hub.example.org/g/Bad_Slug', 'https://hub.example.org/g/a/b', 'ftp://x/g/a', '/home/me/.bowman']) {
    assert.equal(parseGraphHost(notAGraph), null, notAGraph);
  }
});

test('the graph at a host is asked for through its public API', async () => {
  let asked = '';
  const fake = (async (url: string) => {
    asked = url;
    return new Response(JSON.stringify({ result: { data: { repoId: '11111111-1111-4111-8111-111111111111', name: 'Commons Hub' } } }));
  }) as typeof fetch;
  const graph = await fetchGraphAtHost('https://hub.example.org/g/commons-hub/', fake);
  assert.deepStrictEqual(graph, { host: 'https://hub.example.org/g/commons-hub', repoId: '11111111-1111-4111-8111-111111111111', name: 'Commons Hub' });
  assert.equal(asked, `https://hub.example.org/trpc/project.getMeta?input=${encodeURIComponent('{"graph":"commons-hub"}')}`);
});

test('an unreachable or unknown graph says so', async () => {
  await assert.rejects(fetchGraphAtHost('https://hub.example.org/g/x', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch), /cannot be reached/);
  await assert.rejects(fetchGraphAtHost('https://hub.example.org/g/x', (async () => new Response('{}', { status: 404 })) as typeof fetch), /no graph "x"/);
  await assert.rejects(fetchGraphAtHost('not a url'), /not the address of a graph/);
});

test('the ideas at a host are read through its API, unparsable ones left out', async () => {
  const idea = { id: '33333333-3333-4333-8333-333333333333', text: 'Garden', supportingConnections: [], supportedIdeas: [], committedIn: [], status: { state: 'open', comment: '', date: 1 } };
  const fake = (async () => new Response(JSON.stringify({ result: { data: { ideas: [idea, { id: 'broken' }], unreadable: [] } } }))) as typeof fetch;
  const ideas = await fetchIdeasAtHost('https://hub.example.org/g/commons-hub', fake);
  assert.deepStrictEqual(ideas.map((i) => i.text), ['Garden']);
});

test('the inflow takes the place of the linked graph\'s whole intrinsic value', () => {
  assert.deepStrictEqual([...spreadInflow(0.4, new Map([['top', 0.5], ['child', 1]]))], [['top', 0.2], ['child', 0.4]]);
});
