import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serverDirectory } from './server-directory.mjs';

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
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'graphs.json'), 'utf8')).graphs.map((graph: { path: string }) => graph.path), [
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
