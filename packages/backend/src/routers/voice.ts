import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { chatWithGemini } from '../voice-agent.js';

export const voiceRouter = t.router({
  chat: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      transcript: z.string()
    }))
    .mutation(async ({ input }) => {
      const response = await chatWithGemini(input.transcript, input.projectPath);
      return { response };
    })
});
