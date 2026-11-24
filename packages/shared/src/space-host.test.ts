import { test } from 'node:test';
import assert from 'node:assert';
import { fetchSpaceAtHost, fetchIdeasAtHost, intrinsicShares, parseSpaceHost, spreadInflow } from './space-host.js';
import type { Idea } from './types.js';

test('a space address is the origin and the slug of the page URL', () => {
  assert.deepStrictEqual(parseSpaceHost(' https://hub.example.org/spaces/commons-hub/?x=1#top '), { origin: 'https://hub.example.org', slug: 'commons-hub' });
  assert.deepStrictEqual(parseSpaceHost('http://localhost:4100/spaces/v7'), { origin: 'http://localhost:4100', slug: 'v7' });
  for (const notASpace of ['hub.example.org/spaces/x', 'https://hub.example.org/', 'https://hub.example.org/spaces/Bad_Slug', 'https://hub.example.org/spaces/a/b', 'ftp://x/spaces/a', '/home/me/.bowman']) {
    assert.equal(parseSpaceHost(notASpace), null, notASpace);
  }
});

test('the space at a host is asked for through its public API', async () => {
  let asked = '';
  const fake = (async (url: string) => {
    asked = url;
    return new Response(JSON.stringify({ result: { data: { repoId: '11111111-1111-4111-8111-111111111111', name: 'Commons Hub' } } }));
  }) as typeof fetch;
  const space = await fetchSpaceAtHost('https://hub.example.org/spaces/commons-hub/', fake);
  assert.deepStrictEqual(space, { host: 'https://hub.example.org/spaces/commons-hub', repoId: '11111111-1111-4111-8111-111111111111', name: 'Commons Hub' });
  assert.equal(asked, `https://hub.example.org/trpc/project.getMeta?input=${encodeURIComponent('{"space":"commons-hub"}')}`);
});

test('an unreachable or unknown space says so', async () => {
  await assert.rejects(fetchSpaceAtHost('https://hub.example.org/spaces/x', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch), /cannot be reached/);
  await assert.rejects(fetchSpaceAtHost('https://hub.example.org/spaces/x', (async () => new Response('{}', { status: 404 })) as typeof fetch), /no space "x"/);
  await assert.rejects(fetchSpaceAtHost('not a url'), /not the address of a space/);
});

test('the ideas at a host are read through its API, unparsable ones left out', async () => {
  const idea = { id: '33333333-3333-4333-8333-333333333333', text: 'Garden', supportingConnections: [], supportedIdeas: [], committedIn: [], status: { state: 'open', comment: '', date: 1 } };
  const fake = (async () => new Response(JSON.stringify({ result: { data: { ideas: [idea, { id: 'broken' }], unreadable: [] } } }))) as typeof fetch;
  const ideas = await fetchIdeasAtHost('https://hub.example.org/spaces/commons-hub', fake);
  assert.deepStrictEqual(ideas.map((i) => i.text), ['Garden']);
});

test('the inflow takes the place of the linked space\'s whole intrinsic value', () => {
  assert.deepStrictEqual([...spreadInflow(0.4, new Map([['top', 0.5], ['child', 1]]))], [['top', 0.2], ['child', 0.4]]);
});

test('the inflow enters a linked space at its ideas with intrinsic value, or at its top ideas', () => {
  const idea = (id: string, intrinsicValue: number, supportedIdeas: string[] = []) => ({ id, intrinsicValue, supportedIdeas }) as unknown as Idea;
  assert.deepStrictEqual(intrinsicShares([idea('a', 3), idea('b', 1, ['a']), idea('c', 0, ['a'])]), [['a', 0.75], ['b', 0.25]]);
  assert.deepStrictEqual(intrinsicShares([idea('a', 0), idea('b', 0), idea('c', 0, ['a'])]), [['a', 0.5], ['b', 0.5]]);
});
