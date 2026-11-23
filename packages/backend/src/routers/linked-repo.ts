import { z } from 'zod';
import fs from 'fs-extra';
import { LinkedRepoSchema, parseGraphHost, graphHostUrl } from 'shared';
import type { LinkedRepo, LinkedRepoLocal } from 'shared';
import { t, delayedProcedure } from '../trpc.js';
import { seesServerPaths } from '../auth/access.js';
import { resolveBowmanPath } from '../path-completion.js';
import { readProjectMeta, writeProjectMeta } from '../storage/project.js';
import { readLinkedRepoRegistry, writeLinkedRepoRegistry, resolveLinkedRepoLocalPath } from '../storage/linked-repos.js';
import { graphAddress } from '../graphs/address.js';

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
    .input(z.object({ graph: graphAddress }))
    .output(z.array(LinkedRepoStatusSchema))
    .query(async ({ ctx, input }) => {
      const showPaths = seesServerPaths(ctx.viewer);
      const meta = await readProjectMeta(input.graph);
      const registry = await readLinkedRepoRegistry(input.graph);
      const localById = new Map(registry.map((r) => [r.repoId, r]));
      return (meta.linkedRepos ?? []).map((link) => {
        const local = localById.get(link.repoId);
        return {
          ...link,
          localPath: showPaths ? local?.localPath : undefined,
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
      graph: graphAddress,
      targetPath: z.string(),
      url: z.string().optional(),
      access: z.enum(['read', 'write']).default('read'),
      name: z.string().trim().min(1).optional(),
    }))
    .output(LinkedRepoStatusSchema)
    .mutation(async ({ input }) => {
      const target = resolveBowmanPath(input.targetPath);
      if (!(await fs.pathExists(target))) {
        throw new Error(`No .bowman found at target: ${target}`);
      }

      const selfMeta = await readProjectMeta(input.graph);
      const targetMeta = await readProjectMeta(target); // generates+persists target repoId if missing
      const repoId = targetMeta.repoId!;

      if (repoId === selfMeta.repoId) {
        throw new Error('Cannot link a repo to itself.');
      }

      // Portable part → meta.linkedRepos (upsert by repoId).
      const known = selfMeta.linkedRepos?.find((l) => l.repoId === repoId);
      // A name this graph gave the link stays until a new one is given.
      const portable: LinkedRepo = { ...known, repoId, name: input.name ?? known?.name ?? targetMeta.name, ...(input.url ? { url: input.url } : {}) };
      const links = (selfMeta.linkedRepos ?? []).filter((l) => l.repoId !== repoId);
      links.push(portable);
      selfMeta.linkedRepos = links;
      await writeProjectMeta(input.graph, selfMeta);

      // Machine-local part → runtime registry (upsert by repoId).
      const local: LinkedRepoLocal = { repoId, localPath: target, access: input.access };
      const registry = (await readLinkedRepoRegistry(input.graph)).filter((r) => r.repoId !== repoId);
      registry.push(local);
      await writeLinkedRepoRegistry(input.graph, registry);

      return { ...portable, localPath: target, access: input.access, resolved: true };
    }),

  // Link a graph by its address on the server hosting it. The caller (browser
  // or MCP client) asked that server for the graph's identity and name; this
  // server never fetches foreign graphs. No checkout is involved.
  linkHost: delayedProcedure
    .input(z.object({
      graph: graphAddress,
      host: z.string().refine((address) => parseGraphHost(address) !== null, 'Not the address of a graph: https://<server>/spaces/<space>'),
      repoId: z.string().uuid(),
      name: z.string().min(1),
    }))
    .output(LinkedRepoSchema)
    .mutation(async ({ input }) => {
      const meta = await readProjectMeta(input.graph);
      if (input.repoId === meta.repoId) throw new Error('Cannot link a space to itself.');
      const known = meta.linkedRepos?.find((l) => l.repoId === input.repoId);
      const link: LinkedRepo = { ...known, repoId: input.repoId, name: known?.name ?? input.name, host: graphHostUrl(parseGraphHost(input.host)!) };
      meta.linkedRepos = [...(meta.linkedRepos ?? []).filter((l) => l.repoId !== input.repoId), link];
      await writeProjectMeta(input.graph, meta);
      return link;
    }),

  // The name this graph shows for a linked repo. It starts as the target's own
  // name, which can be unclear here (a graph named 'ideas' or 'v3').
  rename: delayedProcedure
    .input(z.object({ graph: graphAddress, repoId: z.string().uuid(), name: z.string().trim().min(1) }))
    .output(LinkedRepoSchema)
    .mutation(async ({ input }) => {
      const meta = await readProjectMeta(input.graph);
      const known = meta.linkedRepos?.find((l) => l.repoId === input.repoId);
      if (!known) throw new Error(`Repo ${input.repoId} is not linked from this graph.`);
      const link: LinkedRepo = { ...known, name: input.name };
      meta.linkedRepos = meta.linkedRepos!.map((l) => (l.repoId === input.repoId ? link : l));
      await writeProjectMeta(input.graph, meta);
      return link;
    }),

  // Drop a linked repo from both the portable list and the local registry.
  unregister: delayedProcedure
    .input(z.object({ graph: graphAddress, repoId: z.string().uuid() }))
    .output(z.object({ repoId: z.string().uuid(), removed: z.boolean() }))
    .mutation(async ({ input }) => {
      const meta = await readProjectMeta(input.graph);
      meta.linkedRepos = (meta.linkedRepos ?? []).filter((l) => l.repoId !== input.repoId);
      await writeProjectMeta(input.graph, meta);

      const registry = (await readLinkedRepoRegistry(input.graph)).filter((r) => r.repoId !== input.repoId);
      await writeLinkedRepoRegistry(input.graph, registry);

      return { repoId: input.repoId, removed: true };
    }),

  // Resolve a repoId to its local checkout — for the black-box node's name and
  // health only. Ideas inside the linked repo are never read (see e81b11c3).
  resolve: delayedProcedure
    .input(z.object({ graph: graphAddress, repoId: z.string().uuid() }))
    .output(z.object({
      repoId: z.string().uuid(),
      name: z.string().optional(),
      localPath: z.string().optional(),
      resolved: z.boolean(),
    }))
    .query(async ({ ctx, input }) => {
      const meta = await readProjectMeta(input.graph);
      const link = (meta.linkedRepos ?? []).find((l) => l.repoId === input.repoId);
      const localPath = await resolveLinkedRepoLocalPath(input.graph, input.repoId);
      return { repoId: input.repoId, name: link?.name, localPath: (seesServerPaths(ctx.viewer) && localPath) || undefined, resolved: !!localPath };
    }),
});
