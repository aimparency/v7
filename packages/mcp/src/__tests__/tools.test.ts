import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { appRouter } from '../../../backend/src/server.js';
import { registerTools } from '../tools.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AIMPARENCY_DIR_NAME } from 'shared';

const caller = appRouter.createCaller({});
const TEST_PROJECT_PATH = path.join(process.cwd(), 'test-mcp-project', AIMPARENCY_DIR_NAME);

// Mock MCP Server
class MockServer {
  handlers = new Map();
  setRequestHandler(schema: any, handler: any) {
    this.handlers.set(schema, handler);
  }
  async callTool(name: string, args: any) {
    const handler = this.handlers.get(CallToolRequestSchema);
    if (!handler) throw new Error("No tool handler registered");
    return await handler({ params: { name, arguments: args } });
  }
  async listTools() {
    const handler = this.handlers.get(ListToolsRequestSchema);
    if (!handler) throw new Error("No list tools handler registered");
    return await handler();
  }
}

beforeEach(async () => {
  await fs.remove(TEST_PROJECT_PATH);
  await fs.ensureDir(TEST_PROJECT_PATH);
});

afterEach(async () => {
  await fs.remove(TEST_PROJECT_PATH);
});

test('MCP Tools - list_aims', async () => {
  const server = new MockServer();
  registerTools(server as any, caller as any);

  // Seed an aim
  await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: { text: 'Test Aim', status: { state: 'open', comment: '', date: Date.now() } }
  });

  const result = await server.callTool('list_aims', { projectPath: TEST_PROJECT_PATH });
  const aims = JSON.parse(result.content[0].text);
  
  assert.equal(aims.length, 1);
  assert.equal(aims[0].text, 'Test Aim');
});

test('MCP Tools - get_aim', async () => {
  const server = new MockServer();
  registerTools(server as any, caller as any);

  const seed = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: { text: 'Target Aim', status: { state: 'open', comment: '', date: Date.now() } }
  });

  const result = await server.callTool('get_aim', { projectPath: TEST_PROJECT_PATH, aimId: seed.id });
  const aim = JSON.parse(result.content[0].text);
  
  assert.equal(aim.id, seed.id);
  assert.equal(aim.text, 'Target Aim');
});

test('MCP Tools - list_phase_aims_recursive', async () => {
  const server = new MockServer();
  registerTools(server as any, caller as any);

  // 1. Create Phase
  const phase = await caller.phase.create({
    projectPath: TEST_PROJECT_PATH,
    phase: { name: 'P1', from: 0, to: 1000 }
  });

  // 2. Create Parent Aim in Phase
  const parentAim = await caller.aim.createAimInPhase({
    projectPath: TEST_PROJECT_PATH,
    phaseId: phase.id,
    aim: { text: 'Parent', status: { state: 'open', comment: '', date: Date.now() } },
    insertionIndex: 0
  });

  // 3. Create Child Aim
  const childAim = await caller.aim.createSubAim({
    projectPath: TEST_PROJECT_PATH,
    parentAimId: parentAim.id,
    aim: { text: 'Child', status: { state: 'open', comment: '', date: Date.now() } },
    positionInParent: 0
  });

  // 4. Test Recursive List
  const result = await server.callTool('list_phase_aims_recursive', { 
    projectPath: TEST_PROJECT_PATH, 
    phaseId: phase.id 
  });
  
  const tree = JSON.parse(result.content[0].text);
  
  assert.equal(tree.length, 1);
  assert.equal(tree[0].text, 'Parent');
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].text, 'Child');
});

test('MCP Tools - create_aim', async () => {
  const server = new MockServer();
  registerTools(server as any, caller as any);

  await server.callTool('create_aim', { 
    projectPath: TEST_PROJECT_PATH, 
    text: 'New MCP Aim',
    tags: ['mcp', 'test']
  });

  const aims = await caller.aim.list({ projectPath: TEST_PROJECT_PATH });
  assert.equal(aims.length, 1);
  assert.equal(aims[0].text, 'New MCP Aim');
  assert.deepEqual(aims[0].tags, ['mcp', 'test']);
});

test('MCP Tools - delete_aim', async () => {
  const server = new MockServer();
  registerTools(server as any, caller as any);

  const aim = await caller.aim.createFloatingAim({
    projectPath: TEST_PROJECT_PATH,
    aim: { text: 'To Delete', status: { state: 'open', comment: '', date: Date.now() } }
  });

  await server.callTool('delete_aim', { projectPath: TEST_PROJECT_PATH, aimId: aim.id });

  const aims = await caller.aim.list({ projectPath: TEST_PROJECT_PATH });
  assert.equal(aims.length, 0);
});
