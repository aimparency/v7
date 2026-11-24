import { z } from 'zod';
import { assertWritableBowman } from 'shared/bowman-migration';
import { t, delayedProcedure } from '../trpc.js';
import { normalizeProjectPath } from '../project-path.js';
import { commitPaths, pushToUpstream, readWorkingTreeStatus } from '../git-working-tree.js';
import { seesServerPaths } from '../auth/access.js';
import { gitEnvFor } from '../spaces/remote-git.js';
import { spaceAddress } from '../spaces/address.js';

// The project's .bowman as part of its repository's working tree.
export const gitRouter = t.router({
  status: delayedProcedure
    .input(z.object({ space: spaceAddress }))
    .query(async ({ ctx, input }) => {
      const status = await readWorkingTreeStatus(normalizeProjectPath(input.space));
      if (!status.isRepository || seesServerPaths(ctx.viewer)) return status;
      const { repositoryPath: _hidden, ...rest } = status;
      return rest;
    }),

  commit: delayedProcedure
    .input(z.object({ space: spaceAddress, paths: z.array(z.string()), message: z.string() }))
    .mutation(async ({ input }) => {
      const bowmanPath = normalizeProjectPath(input.space);
      await assertWritableBowman(bowmanPath);
      return { commit: await commitPaths(bowmanPath, input.paths, input.message) };
    }),

  push: delayedProcedure
    .input(z.object({ space: spaceAddress }))
    .mutation(async ({ input }) => {
      const bowmanPath = normalizeProjectPath(input.space);
      await assertWritableBowman(bowmanPath);
      return { pushed: await pushToUpstream(bowmanPath, await gitEnvFor(bowmanPath)) };
    })
});
