
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import { WebSocket } from "ws";
import type { AppRouter } from "backend";
import path from 'path';
import fs from 'fs-extra';

const TEST_PROJECT_PATH = path.resolve(__dirname, '../../../.bowman-test-date');

// Create tRPC client
const wsClient = createWSClient({
  url: "ws://localhost:3001",
  WebSocket: WebSocket as any,
});

const trpc = createTRPCClient<AppRouter>({
  links: [wsLink({ client: wsClient })],
});

describe('MCP Aim Creation', () => {
  beforeAll(async () => {
    await fs.ensureDir(TEST_PROJECT_PATH);
  });

  afterAll(async () => {
    await fs.remove(TEST_PROJECT_PATH);
    wsClient.close();
  });

  it('date should be set by the server when creating a floating aim without status', async () => {
    const aim = await trpc.aim.createFloatingAim.mutate({
      projectPath: TEST_PROJECT_PATH,
      aim: {
        text: 'Test Aim Without Date',
        description: 'This aim should get a date from server',
        tags: ['test']
      }
    });

    expect(aim).toBeDefined();
    expect(aim.text).toBe('Test Aim Without Date');
    expect(aim.status).toBeDefined();
    expect(aim.status.date).toBeDefined();
    expect(typeof aim.status.date).toBe('number');
    expect(aim.status.date).toBeGreaterThan(0);
    
    // Verify it's recent (within last minute)
    const now = Date.now();
    expect(now - aim.status.date).toBeLessThan(60000);
  });

  it('date should be set by the server when creating a floating aim with partial status (no date)', async () => {
    const aim = await trpc.aim.createFloatingAim.mutate({
      projectPath: TEST_PROJECT_PATH,
      aim: {
        text: 'Test Aim Partial Status',
        status: {
            state: 'open',
            comment: 'Initial comment'
        }
      }
    });

    expect(aim).toBeDefined();
    expect(aim.status.date).toBeDefined();
    expect(typeof aim.status.date).toBe('number');
    // Verify it's recent
    expect(Date.now() - aim.status.date).toBeLessThan(60000);
  });
});
