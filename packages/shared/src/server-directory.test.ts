import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renameGraphsToSpaces, serverDirectory } from './server-directory.mjs';

test('a server directory of the old layout moves to aimparency/<name>, its graphs/ becoming spaces/', () => {
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aimparency-server-directory-'));
  const env = { ...process.env };
  try {
    delete process.env.AIMPARENCY_SERVER_DIR;
    process.env.XDG_DATA_HOME = dataHome;
    process.env.AIMPARENCY_SERVER = 'hub';
    const legacy = path.join(dataHome, 'aimparency-hub');
    fs.mkdirSync(path.join(legacy, 'graphs', 'kitchen'), { recursive: true });
    fs.mkdirSync(path.join(legacy, 'remotes', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'graphs.json'), JSON.stringify({ graphs: [
      { slug: 'kitchen', path: path.join(legacy, 'graphs', 'kitchen') },
      { slug: 'plans', path: path.join(legacy, 'remotes', 'plans') },
      { slug: 'v7', path: '/work/v7' },
    ] }));

    const directory = path.join(dataHome, 'aimparency', 'hub');
    assert.equal(serverDirectory(), directory);
    assert.equal(fs.existsSync(legacy), false);
    assert.ok(fs.existsSync(path.join(directory, 'spaces', 'kitchen')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'spaces.json'), 'utf8')).spaces.map((space: { path: string }) => space.path), [
      path.join(directory, 'spaces', 'kitchen'),
      path.join(directory, 'remotes', 'plans'),
      '/work/v7',
    ]);
    assert.equal(serverDirectory(), directory, 'once moved, it stays');
  } finally {
    process.env = env;
    fs.rmSync(dataHome, { recursive: true, force: true });
  }
});

test('the server files say spaces where they said graphs, once', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aimparency-spaces-rename-'));
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
  try {
    fs.writeFileSync(path.join(directory, 'graphs.json'), JSON.stringify({ graphs: [{ slug: 'kitchen' }] }));
    fs.writeFileSync(path.join(directory, 'server.json'), JSON.stringify({ login: 'accounts', graphCreation: 'selected', limits: { graphsPerAccount: 3, graphMegabytes: 10 } }));
    fs.writeFileSync(path.join(directory, 'accounts.json'), JSON.stringify({
      accounts: [{ id: 'a', canCreateGraphs: true }, { id: 'b' }],
      invitations: [{ code: 'x', canCreateGraphs: true }],
      tokens: [{ hash: 'h', graphs: ['kitchen'] }, { hash: 'i' }]
    }));
    fs.mkdirSync(path.join(directory, 'guest', 'kitchen'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'guest', 'kitchen', 'notes.json'), JSON.stringify({ notes: [
      { id: 'n', kind: 'offer', space: { repoId: 'r', name: 'Ben cooks', host: 'https://hub.example.org/spaces/ben' } },
      { id: 'm', kind: 'note' }
    ] }));

    renameGraphsToSpaces(directory);
    const once = ['spaces.json', 'server.json', 'accounts.json', 'guest/kitchen/notes.json'].map(read);
    renameGraphsToSpaces(directory);

    assert.equal(fs.existsSync(path.join(directory, 'graphs.json')), false);
    assert.deepEqual(read('spaces.json'), { spaces: [{ slug: 'kitchen' }] });
    assert.deepEqual(read('server.json'), { login: 'accounts', spaceCreation: 'selected', limits: { spacesPerAccount: 3, spaceMegabytes: 10 } });
    assert.deepEqual(read('accounts.json'), {
      accounts: [{ id: 'a', canCreateSpaces: true }, { id: 'b' }],
      invitations: [{ code: 'x', canCreateSpaces: true }],
      tokens: [{ hash: 'h', spaces: ['kitchen'] }, { hash: 'i' }]
    });
    assert.equal(read('guest/kitchen/notes.json').notes[0].offeredSpace.name, 'Ben cooks');
    assert.equal(read('guest/kitchen/notes.json').notes[0].space, undefined);
    assert.deepEqual(['spaces.json', 'server.json', 'accounts.json', 'guest/kitchen/notes.json'].map(read), once, 'running again changes nothing');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
