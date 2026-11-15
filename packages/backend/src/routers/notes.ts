import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { serverConfig } from 'shared/server-config';
import { graphHostUrl, parseGraphHost, type LinkedRepo } from 'shared';
import { t, delayedProcedure, type Context } from '../trpc.js';
import { rightOn, viewerFor, type Viewer } from '../auth/access.js';
import { accountNames } from '../auth/accounts.js';
import { resolveGraphAddress } from '../graphs/address.js';
import { graphBowmanPath, listGraphs, type Graph } from '../graphs/registry.js';
import { addNote, findNote, listNotes, mayAddNotes, MAX_NOTE_LENGTH, NOTE_KINDS, NoteError, removeNote, type Note } from '../guest/notes.js';
import { withinLimit } from '../rate-limit.js';
import { getRandomRelativePosition, readIdea, writeIdea } from '../storage/ideas.js';
import { readProjectMeta, writeProjectMeta } from '../storage/project.js';
import { updateIdeaInIndex } from '../search.js';

const RECENT_LIMIT = 50;

async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof NoteError) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    throw error;
  }
}

const viewerOf = (ctx: Context): Viewer => ctx.viewer ?? viewerFor(ctx.session?.token);

// Notes belong to graphs on the server's list; a bare directory has none.
function listedGraph(address: string): Graph | null {
  return resolveGraphAddress(address).graph;
}

function requireGraph(address: string): Graph {
  const graph = listedGraph(address);
  if (!graph) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Notes exist on spaces of a server, not on a bare directory.' });
  return graph;
}

function accountOf(viewer: Viewer): string {
  if (viewer.id === null) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
  return viewer.id;
}

// What a reader gets: the author by name, and whether this note is theirs to remove.
function shown(notes: Note[], graph: Graph, viewer: Viewer) {
  const names = new Map([...new Set(notes.map(note => note.author))].map(id => [id, accountNames([id])[0] ?? '(removed account)']));
  const writes = rightOn(graph, viewer) !== 'read';
  return notes.map(({ author, ...note }) => ({ ...note, author: names.get(author)!, removable: writes || (viewer.id !== null && author === viewer.id) }));
}

export const notesRouter = t.router({
  // The notes on one idea, oldest first, and whether the viewer may add one.
  list: delayedProcedure
    .input(z.object({ graph: z.string(), ideaId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const graph = listedGraph(input.graph);
      const viewer = viewerOf(ctx);
      if (!graph) return { notes: [], mayAdd: false };
      const notes = (await listNotes(graph)).filter(note => note.ideaId === input.ideaId);
      // A visitor without an account may still get one: the UI asks ensureAccount first.
      const mayAdd = viewer.id === null ? (graph.notes ?? serverConfig().guestDefaults.notes) === 'everyone'
        : mayAddNotes(graph, viewer.id, rightOn(graph, viewer) !== 'read');
      return { notes: shown(notes, graph, viewer), mayAdd };
    }),

  add: delayedProcedure
    .input(z.object({
      graph: z.string(),
      ideaId: z.string().uuid(),
      kind: z.enum(NOTE_KINDS),
      text: z.string().max(MAX_NOTE_LENGTH + 100),
      // An offer's space, as the proposer's browser read it from its server:
      // this server never fetches foreign spaces. Its owner previews it before accepting.
      space: z.object({
        host: z.string().max(500).refine(address => parseGraphHost(address) !== null, 'Not the address of a space: https://<server>/spaces/<space>'),
        repoId: z.string().uuid(),
        name: z.string().trim().min(1).max(200)
      }).optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const graph = requireGraph(input.graph);
      const viewer = viewerOf(ctx);
      const author = accountOf(viewer);
      if (!mayAddNotes(graph, author, rightOn(graph, viewer) !== 'read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'The owner of this space has not opened it for your notes.' });
      }
      if (!withinLimit('notes', author, serverConfig().limits.notesPerAccountPerHour)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many notes in the last hour: try again later.' });
      }
      await readIdea(graphBowmanPath(graph), input.ideaId); // a note needs its idea
      const space = input.space && { ...input.space, host: graphHostUrl(parseGraphHost(input.space.host)!) };
      if (space && space.repoId === (await readProjectMeta(graphBowmanPath(graph))).repoId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A space cannot be offered to itself.' });
      }
      const note = await run(() => addNote(graph, { ideaId: input.ideaId, kind: input.kind, text: input.text, author, ...(space ? { space } : {}) }));
      return shown([note], graph, viewer)[0]!;
    }),

  remove: delayedProcedure
    .input(z.object({ graph: z.string(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const graph = requireGraph(input.graph);
      const viewer = viewerOf(ctx);
      const account = accountOf(viewer);
      const writes = rightOn(graph, viewer) !== 'read';
      await run(() => removeNote(graph, input.id, note => writes || note.author === account));
      return { success: true };
    }),

  // The offered space supports the idea from now on: it is linked by its
  // address, the idea gets the space as a supporting connection with the
  // proposer's pitch as its hypothesis, and the offer is done.
  acceptOffer: delayedProcedure
    .input(z.object({ graph: z.string(), id: z.string().uuid(), weight: z.number().min(0).optional() }))
    .mutation(async ({ input }) => {
      const graph = requireGraph(input.graph);
      const offer = await run(() => findNote(graph, input.id));
      if (offer.kind !== 'offer' || !offer.space) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This note offers no space.' });
      const bowman = graphBowmanPath(graph);
      const idea = await readIdea(bowman, offer.ideaId);
      const { host, repoId, name } = offer.space;

      const meta = await readProjectMeta(bowman);
      const known = meta.linkedRepos?.find(link => link.repoId === repoId);
      const link: LinkedRepo = { ...known, repoId, name, host };
      meta.linkedRepos = [...(meta.linkedRepos ?? []).filter(other => other.repoId !== repoId), link];
      await writeProjectMeta(bowman, meta);

      const edge = {
        repoId,
        relativePosition: idea.supportingRepos?.find(other => other.repoId === repoId)?.relativePosition ?? getRandomRelativePosition(),
        weight: input.weight ?? 1,
        ...(offer.text ? { hypothesis: offer.text } : {})
      };
      const accepted = { ...idea, supportingRepos: [...(idea.supportingRepos ?? []).filter(other => other.repoId !== repoId), edge] };
      await writeIdea(bowman, accepted);
      updateIdeaInIndex(bowman, accepted);
      await run(() => removeNote(graph, offer.id, () => true));
      return { ideaId: idea.id };
    }),

  // New notes on the graphs the viewer owns or writes, newest first: what the
  // header's badge shows. A note whose idea is gone is left out.
  recent: delayedProcedure.query(async ({ ctx }) => {
    const viewer = viewerOf(ctx);
    if (viewer.id === null) return [];
    const mine = listGraphs().filter(graph => rightOn(graph, viewer) !== 'read');
    const all = (await Promise.all(mine.map(async graph =>
      shown((await listNotes(graph)).filter(note => note.author !== viewer.id), graph, viewer).map(note => ({ ...note, slug: graph.slug, graph }))
    ))).flat().sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, RECENT_LIMIT);
    const withIdeas = await Promise.all(all.map(async ({ graph, ...note }) => {
      const idea = await readIdea(graphBowmanPath(graph), note.ideaId).catch(() => null);
      return idea && { ...note, ideaText: idea.text };
    }));
    return withIdeas.flatMap(note => note ?? []);
  })
});
