import { z } from 'zod';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

export const createMarketRouter = (
  t: any,
  delayedProcedure: any
) => {
  return t.router({
    updateConfig: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        config: z.object({
          risk_level: z.number().optional(),
          leverage: z.number().optional(),
          strategy: z.string().optional()
        })
      }))
      .mutation(async ({ input }: any) => {
        // Find root dir by going up from this file's location
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const ROOT_DIR = path.resolve(__dirname, '../../..');
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
};
