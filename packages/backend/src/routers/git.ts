import { z } from 'zod';
import { assertWritableBowman } from 'shared/bowman-migration';
import { t, delayedProcedure } from '../trpc.js';
import { normalizeProjectPath } from '../project-path.js';
import { commitPaths, pushToUpstream, readWorkingTreeStatus } from '../git-working-tree.js';
import { seesServerPaths } from '../auth/access.js';

// The project's .bowman as part of its repository's working tree.
export const gitRouter = t.router({
  status: delayedProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(async ({ ctx, input }) => {
      const status = await readWorkingTreeStatus(normalizeProjectPath(input.projectPath));
      if (!status.isRepository || seesServerPaths(ctx.viewer)) return status;
      const { repositoryPath: _hidden, ...rest } = status;
      return rest;
    }),

  commit: delayedProcedure
    .input(z.object({ projectPath: z.string(), paths: z.array(z.string()), message: z.string() }))
    .mutation(async ({ input }) => {
      const bowmanPath = normalizeProjectPath(input.projectPath);
      await assertWritableBowman(bowmanPath);
      return { commit: await commitPaths(bowmanPath, input.paths, input.message) };
    }),

  push: delayedProcedure
    .input(z.object({ projectPath: z.string() }))
    .mutation(async ({ input }) => {
      const bowmanPath = normalizeProjectPath(input.projectPath);
      await assertWritableBowman(bowmanPath);
      return { pushed: await pushToUpstream(bowmanPath) };
    })
});
