import { z } from 'zod';
import { t, delayedProcedure } from '../trpc.js';
import {
  CONTINUE_HOOK_AGENTS, continueHookStatus, deleteHookLoop, disableContinueHook, enableContinueHook, listHookLoops, saveHookLoop,
  type ContinueHookStatus, type HookLoop
} from 'shared/continue-hook';
import { graphAddress } from '../graphs/address.js';

// The agents' Stop continuation hook and its loops (what it tells the agent),
// the same switch as the MCP enable/disable_continue_hook tools. Local, or for
// server admins when agents are on (auth/access.ts).

type HookState = ContinueHookStatus & { loops: HookLoop[] };

const readState = (projectPath: string): HookState => {
  try {
    return { ...continueHookStatus(projectPath), loops: listHookLoops(projectPath) };
  } catch {
    return { installed: false, enabled: false, loop: null, loops: [] }; // not a git repository
  }
};

const slug = z.string().regex(/^[a-z0-9-]+$/);

export const continueHookRouter = t.router({
  get: delayedProcedure
    .input(z.object({ graph: graphAddress }))
    .query(({ input }) => readState(input.graph)),

  /** "none" turns the hook off; "default" or a saved loop's slug turns it on with that loop. */
  select: delayedProcedure
    .input(z.object({ graph: graphAddress, loop: z.union([z.literal('none'), slug]), agent: z.enum(CONTINUE_HOOK_AGENTS).optional() }))
    .mutation(({ input }) => {
      if (input.loop === 'none') disableContinueHook(input.graph);
      else enableContinueHook(input.graph, { agent: input.agent, loop: input.loop });
      return readState(input.graph);
    }),

  /** Without slug (or with the default's) a new loop; returns the state and the saved slug. */
  saveLoop: delayedProcedure
    .input(z.object({ graph: graphAddress, slug: slug.optional(), title: z.string().min(1), work: z.string().min(1), human: z.string() }))
    .mutation(({ input }) => {
      const saved = saveHookLoop(input.graph, input);
      return { ...readState(input.graph), saved };
    }),

  deleteLoop: delayedProcedure
    .input(z.object({ graph: graphAddress, slug }))
    .mutation(({ input }) => {
      deleteHookLoop(input.graph, input.slug);
      return readState(input.graph);
    })
});
