import { z } from 'zod';
import type { ProcedureBuilder } from '@trpc/server';

export const createVoiceRouter = (
  t: any,
  delayedProcedure: ProcedureBuilder<any, any>,
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
