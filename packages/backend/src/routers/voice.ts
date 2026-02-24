import { z } from 'zod';
import type { BaseProcedure, RouterBuilder } from './trpc-types.js';

export const createVoiceRouter = (
  t: RouterBuilder,
  delayedProcedure: BaseProcedure,
  chatWithGemini: (transcript: string, projectPath: string) => Promise<string>
) => {
  return t.router({
    chat: delayedProcedure
      .input(z.object({
        projectPath: z.string(),
        transcript: z.string()
      }))
      .mutation(async ({ input }: any) => {
        const response = await chatWithGemini(input.transcript, input.projectPath);
        return { response };
      })
  });
};
