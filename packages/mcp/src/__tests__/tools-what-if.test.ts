import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { registerTools } from '../tools/index.js';
import { MockServer, caller, createCallerProxy, createTestContext } from './test-utils.js';

let ctx: ReturnType<typeof createTestContext>;
beforeEach(async () => { ctx = createTestContext(); await ctx.setup(); });
afterEach(async () => { await ctx.teardown(); });

const open = { state: 'open', comment: '', date: 0 };
const snapshot = async () => JSON.stringify((await caller.idea.list({ graph: ctx.projectPath })).sort((left, right) => left.id.localeCompare(right.id)));

test('what_if shows how removing an idea or reweighting a connection moves value, and writes nothing', async () => {
  const server = new MockServer();
  registerTools(server as any, createCallerProxy(caller) as any);
  const root = await caller.idea.createFloatingIdea({ graph: ctx.projectPath, idea: { text: 'Root', intrinsicValue: 100, status: open } });
  const a = await caller.idea.createFloatingIdea({ graph: ctx.projectPath, idea: { text: 'A', status: open } });
  const b = await caller.idea.createFloatingIdea({ graph: ctx.projectPath, idea: { text: 'B', status: open } });
  await caller.idea.connectIdeas({ graph: ctx.projectPath, parentIdeaId: root.id, childIdeaId: a.id });
  await caller.idea.connectIdeas({ graph: ctx.projectPath, parentIdeaId: root.id, childIdeaId: b.id });
  const before = await snapshot();

  const removed = JSON.parse((await server.callTool('what_if', { space: ctx.projectPath, change: 'remove', ideaId: b.id.slice(0, 8) })).content[0].text);
  const shiftA = removed.shifts.find((shift: any) => shift.id === a.id);
  const [from, to] = shiftA.value.split(' -> ').map(Number);
  assert.ok(to > from, `A takes B's share: ${shiftA.value}`);

  const reweighted = JSON.parse((await server.callTool('what_if', { space: ctx.projectPath, change: 'weight', parentId: root.id, childId: a.id, weight: 5 })).content[0].text);
  assert.ok(reweighted.shifts.some((shift: any) => shift.id === b.id));
  assert.equal(await snapshot(), before, 'nothing is written');
});
