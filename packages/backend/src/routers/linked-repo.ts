import { z } from 'zod';
import fs from 'fs-extra';
import { LinkedRepoSchema } from 'shared';
import type { LinkedRepo, LinkedRepoLocal } from 'shared';
import { t, delayedProcedure } from '../trpc.js';
import { resolveBowmanPath } from '../path-completion.js';
import { readProjectMeta, writeProjectMeta } from '../storage/project.js';
import { readLinkedRepoRegistry, writeLinkedRepoRegistry, resolveLinkedRepoLocalPath } from '../storage/linked-repos.js';

// A portable link plus this machine's resolution status (localPath present ⇒
// checked out here). Explicit output schemas keep the router's inferred type
// nameable (portable .d.ts emit) and document the cross-repo API contract.
const LinkedRepoStatusSchema = LinkedRepoSchema.extend({
  localPath: z.string().optional(),
  access: z.enum(['read', 'write']).optional(),
  resolved: z.boolean(),
});

export const linkedRepoRouter = t.router({
  // Portable links (from meta) merged with this machine's resolution status.
  list: delayedProcedure
    .input(z.object({ projectPath: z.string() }))
    .output(z.array(LinkedRepoStatusSchema))
    .query(async ({ input }) => {
      const meta = await readProjectMeta(input.projectPath);
      const registry = await readLinkedRepoRegistry(input.projectPath);
      const localById = new Map(registry.map((r) => [r.repoId, r]));
      return (meta.linkedRepos ?? []).map((link) => {
        const local = localById.get(link.repoId);
        return {
          ...link,
          localPath: local?.localPath,
          access: local?.access,
          resolved: !!local, // false ⇒ linked but not checked out here
        };
      });
    }),

  // Register a sibling project as a linked repo: read its stable repoId from its
  // meta (generating one if absent), record the portable part in this repo's
  // meta and the machine-local path in the runtime registry.
  register: delayedProcedure
    .input(z.object({
      projectPath: z.string(),
      targetPath: z.string(),
      url: z.string().optional(),
      access: z.enum(['read', 'write']).default('read'),
    }))
    .output(LinkedRepoStatusSchema)
    .mutation(async ({ input }) => {
      const target = resolveBowmanPath(input.targetPath);
      if (!(await fs.pathExists(target))) {
        throw new Error(`No .bowman found at target: ${target}`);
      }

      const selfMeta = await readProjectMeta(input.projectPath);
      const targetMeta = await readProjectMeta(target); // generates+persists target repoId if missing
      const repoId = targetMeta.repoId!;

      if (repoId === selfMeta.repoId) {
        throw new Error('Cannot link a repo to itself.');
      }

      // Portable part → meta.linkedRepos (upsert by repoId).
      const portable: LinkedRepo = { repoId, name: targetMeta.name, ...(input.url ? { url: input.url } : {}) };
      const links = (selfMeta.linkedRepos ?? []).filter((l) => l.repoId !== repoId);
      links.push(portable);
      selfMeta.linkedRepos = links;
      await writeProjectMeta(input.projectPath, selfMeta);

      // Machine-local part → runtime registry (upsert by repoId).
      const local: LinkedRepoLocal = { repoId, localPath: target, access: input.access };
      const registry = (await readLinkedRepoRegistry(input.projectPath)).filter((r) => r.repoId !== repoId);
      registry.push(local);
      await writeLinkedRepoRegistry(input.projectPath, registry);

      return { ...portable, localPath: target, access: input.access, resolved: true };
    }),

  // Drop a linked repo from both the portable list and the local registry.
  unregister: delayedProcedure
    .input(z.object({ projectPath: z.string(), repoId: z.string().uuid() }))
    .output(z.object({ repoId: z.string().uuid(), removed: z.boolean() }))
    .mutation(async ({ input }) => {
      const meta = await readProjectMeta(input.projectPath);
      meta.linkedRepos = (meta.linkedRepos ?? []).filter((l) => l.repoId !== input.repoId);
      await writeProjectMeta(input.projectPath, meta);

      const registry = (await readLinkedRepoRegistry(input.projectPath)).filter((r) => r.repoId !== input.repoId);
      await writeLinkedRepoRegistry(input.projectPath, registry);

      return { repoId: input.repoId, removed: true };
    }),

  // Resolve a repoId to its local checkout — for the black-box node's name and
  // health only. Ideas inside the linked repo are never read (see e81b11c3).
  resolve: delayedProcedure
    .input(z.object({ projectPath: z.string(), repoId: z.string().uuid() }))
    .output(z.object({
      repoId: z.string().uuid(),
      name: z.string().optional(),
      localPath: z.string().optional(),
      resolved: z.boolean(),
    }))
    .query(async ({ input }) => {
      const meta = await readProjectMeta(input.projectPath);
      const link = (meta.linkedRepos ?? []).find((l) => l.repoId === input.repoId);
      const localPath = await resolveLinkedRepoLocalPath(input.projectPath, input.repoId);
      return { repoId: input.repoId, name: link?.name, localPath: localPath ?? undefined, resolved: !!localPath };
    }),
});
