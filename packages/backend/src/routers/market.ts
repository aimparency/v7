import { z } from 'zod';
import fs from 'fs-extra';
import path from 'path';
import { packageRoot } from 'shared/node-entry';
import { t, delayedProcedure } from '../trpc.js';

export const marketRouter = t.router({
  updateConfig: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      config: z.object({
        risk_level: z.number().optional(),
        leverage: z.number().optional(),
        strategy: z.string().optional()
      })
    }))
    .mutation(async ({ input }) => {
      const ROOT_DIR = path.resolve(packageRoot(import.meta.url), '../..');
      const configPath = path.join(ROOT_DIR, 'subdev/market-alpha/config.json');
      let current = {};
      if (await fs.pathExists(configPath)) {
        current = await fs.readJson(configPath);
      }
      const updated = { ...current, ...input.config };
      await fs.writeJson(configPath, updated, { spaces: 2 });
      return updated;
    })
});
