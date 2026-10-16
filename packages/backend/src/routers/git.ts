import path from 'node:path';
import { z } from 'zod';
import { assertWritableBowman } from 'shared/bowman-migration';
import { t, delayedProcedure } from '../trpc.js';
import { normalizeProjectPath } from '../project-path.js';
import { commitPaths, readWorkingTreeStatus } from '../git-working-tree.js';

// The working tree of the repository that holds the project's .bowman.
export const gitRouter = t.router({
  status: delayedProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(({ input }) => readWorkingTreeStatus(path.dirname(normalizeProjectPath(input.projectPath)))),

  commit: delayedProcedure
    .input(z.object({ projectPath: z.string(), paths: z.array(z.string()), message: z.string() }))
    .mutation(async ({ input }) => {
      const bowmanPath = normalizeProjectPath(input.projectPath);
      await assertWritableBowman(bowmanPath);
      return { commit: await commitPaths(path.dirname(bowmanPath), input.paths, input.message) };
    })
});
