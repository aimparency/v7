import { test } from 'node:test';
import assert from 'node:assert';
import { fetchGraphAtHost, parseGraphHost } from './graph-host.js';

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
