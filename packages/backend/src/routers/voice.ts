import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { chatWithGemini } from '../voice-agent.js';
import { graphAddress } from '../graphs/address.js';

export const voiceRouter = t.router({
  chat: delayedProcedure
    .input(z.object({
      projectPath: graphAddress,
      transcript: z.string()
    }))
    .mutation(async ({ input }) => {
      const response = await chatWithGemini(input.transcript, input.projectPath);
      return { response };
    })
});
