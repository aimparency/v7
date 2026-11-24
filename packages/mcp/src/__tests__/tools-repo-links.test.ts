import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import { registerTools } from '../tools/index.js';
import { MockServer, caller, createCallerProxy, createTestContext } from './test-utils.js';

// Black-box repo links over MCP: an agent must be able to see and create an
// idea -> whole-external-repo edge without ever reading the other repo's ideas.

let ctx: ReturnType<typeof createTestContext>;
let targetCtx: ReturnType<typeof createTestContext>;

async function createIdea(server: MockServer, args: Record<string, unknown>) {
  const review = await server.callTool('create_idea', args);
  const confirmationToken = JSON.parse(review.content[0].text).confirmationToken;
  return await server.callTool('create_idea', { ...args, confirmationToken });
}

function makeServer() {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);
  return server;
}

beforeEach(async () => {
  ctx = createTestContext();
  targetCtx = createTestContext();
  await ctx.setup();
  await targetCtx.setup();
  await fs.writeJson(`${targetCtx.projectPath}/meta.json`, { name: 'Ways of Will', color: '#336699' });
});

afterEach(async () => {
  await ctx.teardown();
  await targetCtx.teardown();
});

test('register -> link -> read -> unlink round-trip over MCP', async () => {
  const server = makeServer();

  await createIdea(server, { space: ctx.projectPath, text: 'Local idea carried by another repo' });
  const ideaId = (await caller.idea.list({ space: ctx.projectPath }))[0]!.id;

  // register_linked_repo picks up the target's generated repoId + name.
  await server.callTool('register_linked_repo', {
    space: ctx.projectPath,
    targetPath: targetCtx.projectPath,
  });

  const listed = JSON.parse(
    (await server.callTool('list_linked_repos', { space: ctx.projectPath })).content[0].text
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'Ways of Will');
  assert.equal(listed[0].resolved, true);
  const repoId = listed[0].repoId;

  await server.callTool('link_repo', {
    space: ctx.projectPath,
    ideaId,
    repoId,
    weight: 2,
    hypothesis: 'that project does the actual work',
  });

  // Stored as a {repoId}-only edge — no ideaId reaches into the other repo.
  const stored = await caller.idea.get({ space: ctx.projectPath, ideaId });
  assert.equal(stored.supportingRepos!.length, 1);
  assert.equal(stored.supportingRepos![0]!.repoId, repoId);
  assert.equal(stored.supportingRepos![0]!.weight, 2);
  assert.ok(!('ideaId' in stored.supportingRepos![0]!));

  // get_idea resolves the edge to a name + health so the UUID isn't opaque.
  const fetched = JSON.parse(
    (await server.callTool('get_idea', { space: ctx.projectPath, ideaId })).content[0].text
  );
  assert.deepEqual(fetched.supportingRepos, [
    { repoId, name: 'Ways of Will', weight: 2, hypothesis: 'that project does the actual work', health: 'resolved' },
  ]);

  // get_idea_context surfaces repo supporters separately from idea children.
  const context = JSON.parse(
    (await server.callTool('get_idea_context', { space: ctx.projectPath, ideaId })).content[0].text
  );
  assert.equal(context.supporting_repos.length, 1);
  assert.equal(context.supporting_repos[0].name, 'Ways of Will');
  assert.deepEqual(context.children, []);

  await server.callTool('unlink_repo', { space: ctx.projectPath, ideaId, repoId });
  const afterUnlink = await caller.idea.get({ space: ctx.projectPath, ideaId });
  assert.deepEqual(afterUnlink.supportingRepos, []);

  // Unlinking an idea leaves the repo registered for other ideas to use.
  const stillListed = JSON.parse(
    (await server.callTool('list_linked_repos', { space: ctx.projectPath })).content[0].text
  );
  assert.equal(stillListed.length, 1);
});

test('link_repo refuses an unregistered repoId and names the known repos', async () => {
  const server = makeServer();
  await createIdea(server, { space: ctx.projectPath, text: 'Local idea' });
  const ideaId = (await caller.idea.list({ space: ctx.projectPath }))[0]!.id;

  await server.callTool('register_linked_repo', {
    space: ctx.projectPath,
    targetPath: targetCtx.projectPath,
  });

  const result = await server.callTool('link_repo', {
    space: ctx.projectPath,
    ideaId,
    repoId: '4e6f9f1c-ee6c-4f35-b91e-1467ae9839ee',
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not in this project's linked-repo registry/);
  assert.match(result.content[0].text, /Ways of Will/); // names what IS available

  const stored = await caller.idea.get({ space: ctx.projectPath, ideaId });
  assert.ok(!stored.supportingRepos?.length, 'no dead-sink edge is written');
});

test('a linked repo that is not checked out here reads as not-checked-out, not broken', async () => {
  const server = makeServer();
  await createIdea(server, { space: ctx.projectPath, text: 'Local idea' });
  const ideaId = (await caller.idea.list({ space: ctx.projectPath }))[0]!.id;

  await server.callTool('register_linked_repo', {
    space: ctx.projectPath,
    targetPath: targetCtx.projectPath,
  });
  const repoId = JSON.parse(
    (await server.callTool('list_linked_repos', { space: ctx.projectPath })).content[0].text
  )[0].repoId;
  await server.callTool('link_repo', { space: ctx.projectPath, ideaId, repoId });

  // Drop only the machine-local resolution, as on a fresh clone: the portable
  // meta entry survives, so the link keeps its name and stays a valid edge.
  await fs.remove(`${ctx.projectPath}/runtime/linked-repos.json`);

  const fetched = JSON.parse(
    (await server.callTool('get_idea', { space: ctx.projectPath, ideaId })).content[0].text
  );
  assert.equal(fetched.supportingRepos[0].health, 'not-checked-out');
  assert.equal(fetched.supportingRepos[0].name, 'Ways of Will');
});

test('link_repo takes a share in percent and answers with the split; a link keeps the name this space gives it', async () => {
  const server = makeServer();
  await createIdea(server, { space: ctx.projectPath, text: 'Parent' });
  const parentId = (await caller.idea.list({ space: ctx.projectPath }))[0]!.id;
  await createIdea(server, { space: ctx.projectPath, text: 'Child', supportedIdeas: [parentId] });

  await server.callTool('register_linked_repo', { space: ctx.projectPath, targetPath: targetCtx.projectPath, name: 'Will repo' });
  const repoId = JSON.parse((await server.callTool('list_linked_repos', { space: ctx.projectPath })).content[0].text)[0].repoId;

  const refused = await server.callTool('link_repo', { space: ctx.projectPath, ideaId: parentId, repoId, share: 100 });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /nothing for its other children/);
  assert.equal((await caller.idea.get({ space: ctx.projectPath, ideaId: parentId })).supportingRepos?.length ?? 0, 0, 'a refused share writes no link');

  const reply = (await server.callTool('link_repo', { space: ctx.projectPath, ideaId: parentId, repoId, share: 40 })).content[0].text;
  assert.match(reply, new RegExp(`40% → repo Will repo \\(${repoId}\\)`));
  const parent = await caller.idea.get({ space: ctx.projectPath, ideaId: parentId });
  const total = parent.supportingConnections.reduce((sum, conn) => sum + conn.weight, 0) + parent.supportingRepos![0]!.weight + (parent.selfWeight ?? 0);
  assert.ok(Math.abs(parent.supportingRepos![0]!.weight / total - 0.4) < 1e-9);

  await server.callTool('register_linked_repo', { space: ctx.projectPath, repoId, name: 'Ways of Will (life)' });
  const listed = JSON.parse((await server.callTool('list_linked_repos', { space: ctx.projectPath })).content[0].text);
  assert.equal(listed[0].name, 'Ways of Will (life)');
});
