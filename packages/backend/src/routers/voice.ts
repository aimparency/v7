import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import { chatWithGemini } from '../voice-agent.js';
import { spaceAddress } from '../spaces/address.js';

export const voiceRouter = t.router({
  chat: delayedProcedure
    .input(z.object({
      space: spaceAddress,
      transcript: z.string()
    }))
    .mutation(async ({ input }) => {
      const response = await chatWithGemini(input.transcript, input.space);
      return { response };
    })
});
