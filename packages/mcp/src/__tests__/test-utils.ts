import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { appRouter } from '../../../backend/src/server.js';
import { closeDb } from '../../../backend/src/db.js';
import { AIMPARENCY_DIR_NAME } from 'shared';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { v4 as uuidv4 } from 'uuid';

export const caller = appRouter.createCaller({});

export class MockServer {
  handlers = new Map();
  
  setRequestHandler(schema: any, handler: any) {
    this.handlers.set(schema, handler);
  }
  
  async callTool(name: string, args: any) {
    const handler = this.handlers.get(CallToolRequestSchema);
    if (!handler) throw new Error("No tool handler registered");
    try {
        return await handler({ params: { name, arguments: args } });
    } catch (e) {
        console.error(`Error calling tool ${name}:`, e);
        throw e;
    }
  }
  
  async listTools() {
    const handler = this.handlers.get(ListToolsRequestSchema);
    if (!handler) throw new Error("No list tools handler registered");
    return await handler();
  }

  async listResources() {
    const handler = this.handlers.get(ListResourcesRequestSchema);
    if (!handler) throw new Error("No list resources handler registered");
    return await handler();
  }

  async readResource(uri: string) {
    const handler = this.handlers.get(ReadResourceRequestSchema);
    if (!handler) throw new Error("No read resource handler registered");
    try {
        return await handler({ params: { uri } });
    } catch (e) {
        console.error(`Error reading resource ${uri}:`, e);
        throw e;
    }
  }
}

export function createCallerProxy(target: any): any {
  if (target === undefined || target === null) return target;

  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'query' || prop === 'mutate' || prop === 'subscription') {
        return (...args: any[]) => {
            return typeof t === 'function' ? t.apply(undefined, args) : undefined;
        };
      }
      
      const value = t[prop];
      return createCallerProxy(value);
    }
  });
}

export const createTestContext = () => {
  const id = uuidv4();
  const projectPath = path.join(process.cwd(), `test-mcp-project-${id}`, AIMPARENCY_DIR_NAME);
  
  return {
    projectPath,
    setup: async () => {
      await fs.remove(projectPath);
      await fs.ensureDir(projectPath);
    },
    teardown: async () => {
      try {
          closeDb(projectPath);
      } catch(e) {
          console.error("Error closing DB:", e);
      }
      // Retry removal if ENOTEMPTY (Windows/Race condition issue)
      for(let i=0; i<3; i++) {
          try {
            await fs.remove(projectPath);
            break;
          } catch(e) {
            await new Promise(r => setTimeout(r, 100));
          }
      }
    }
  };
};
