import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { serverConfig } from 'shared/server-config';
import { spaceHostUrl, parseSpaceHost, type LinkedRepo } from 'shared';
import { t, delayedProcedure, type Context } from '../trpc.js';
import { rightOn, viewerFor, type Viewer } from '../auth/access.js';
import { accountNames } from '../auth/accounts.js';
import { resolveSpaceAddress } from '../spaces/address.js';
import { spaceBowmanPath, listSpaces, type Space } from '../spaces/registry.js';
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

// Notes belong to spaces on the server's list; a bare directory has none.
function listedSpace(address: string): Space | null {
  return resolveSpaceAddress(address).space;
}

function requireSpace(address: string): Space {
  const space = listedSpace(address);
  if (!space) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Notes exist on spaces of a server, not on a bare directory.' });
  return space;
}

function accountOf(viewer: Viewer): string {
  if (viewer.id === null) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
  return viewer.id;
}

// What a reader gets: the author by name, and whether this note is theirs to remove.
function shown(notes: Note[], space: Space, viewer: Viewer) {
  const names = new Map([...new Set(notes.map(note => note.author))].map(id => [id, accountNames([id])[0] ?? '(removed account)']));
  const writes = rightOn(space, viewer) !== 'read';
  return notes.map(({ author, ...note }) => ({ ...note, author: names.get(author)!, removable: writes || (viewer.id !== null && author === viewer.id) }));
}

export const notesRouter = t.router({
  // The notes on one idea, oldest first, and whether the viewer may add one.
  list: delayedProcedure
    .input(z.object({ space: z.string(), ideaId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const space = listedSpace(input.space);
      const viewer = viewerOf(ctx);
      if (!space) return { notes: [], mayAdd: false };
      const notes = (await listNotes(space)).filter(note => note.ideaId === input.ideaId);
      // A visitor without an account may still get one: the UI asks ensureAccount first.
      const mayAdd = viewer.id === null ? (space.notes ?? serverConfig().guestDefaults.notes) === 'everyone'
        : mayAddNotes(space, viewer.id, rightOn(space, viewer) !== 'read');
      return { notes: shown(notes, space, viewer), mayAdd };
    }),

  add: delayedProcedure
    .input(z.object({
      space: z.string(),
      ideaId: z.string().uuid(),
      kind: z.enum(NOTE_KINDS),
      text: z.string().max(MAX_NOTE_LENGTH + 100),
      // An offer's space, as the proposer's browser read it from its server:
      // this server never fetches foreign spaces. Its owner previews it before accepting.
      offeredSpace: z.object({
        host: z.string().max(500).refine(address => parseSpaceHost(address) !== null, 'Not the address of a space: https://<server>/spaces/<space>'),
        repoId: z.string().uuid(),
        name: z.string().trim().min(1).max(200)
      }).optional(),
      relativePosition: z.tuple([z.number().finite(), z.number().finite()]).optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const space = requireSpace(input.space);
      const viewer = viewerOf(ctx);
      const author = accountOf(viewer);
      if (!mayAddNotes(space, author, rightOn(space, viewer) !== 'read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'The owner of this space has not opened it for your notes.' });
      }
      if (!withinLimit('notes', author, serverConfig().limits.notesPerAccountPerHour)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many notes in the last hour: try again later.' });
      }
      await readIdea(spaceBowmanPath(space), input.ideaId); // a note needs its idea
      const offeredSpace = input.offeredSpace && { ...input.offeredSpace, host: spaceHostUrl(parseSpaceHost(input.offeredSpace.host)!) };
      if (offeredSpace && offeredSpace.repoId === (await readProjectMeta(spaceBowmanPath(space))).repoId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A space cannot be offered to itself.' });
      }
      const note = await run(() => addNote(space, { ideaId: input.ideaId, kind: input.kind, text: input.text, author, ...(offeredSpace ? { offeredSpace } : {}),
        ...(offeredSpace && input.relativePosition ? { relativePosition: input.relativePosition } : {}) }));
      return shown([note], space, viewer)[0]!;
    }),

  remove: delayedProcedure
    .input(z.object({ space: z.string(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const space = requireSpace(input.space);
      const viewer = viewerOf(ctx);
      const account = accountOf(viewer);
      const writes = rightOn(space, viewer) !== 'read';
      await run(() => removeNote(space, input.id, note => writes || note.author === account));
      return { success: true };
    }),

  // The offers on this space that the viewer is part of: all of them for
  // those who write it (they decide), a visitor's own otherwise. The space
  // shows them as unconfirmed supporters; nobody else sees them there.
  offers: delayedProcedure
    .input(z.object({ space: z.string() }))
    .query(async ({ ctx, input }) => {
      const space = listedSpace(input.space);
      const viewer = viewerOf(ctx);
      if (!space || viewer.id === null) return [];
      const writes = rightOn(space, viewer) !== 'read';
      const offers = (await listNotes(space)).filter(note => note.kind === 'offer' && note.offeredSpace && (writes || note.author === viewer.id));
      return shown(offers, space, viewer).map(offer => ({ ...offer, mine: offers.find(own => own.id === offer.id)!.author === viewer.id }));
    }),

  // The offered space supports the idea from now on: it is linked by its
  // address, the idea gets the space as a supporting connection with the
  // proposer's pitch as its hypothesis, and the offer is done.
  acceptOffer: delayedProcedure
    .input(z.object({ space: z.string(), id: z.string().uuid(), weight: z.number().min(0).optional() }))
    .mutation(async ({ input }) => {
      const space = requireSpace(input.space);
      const offer = await run(() => findNote(space, input.id));
      if (offer.kind !== 'offer' || !offer.offeredSpace) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This note offers no space.' });
      const bowman = spaceBowmanPath(space);
      const idea = await readIdea(bowman, offer.ideaId);
      const { host, repoId, name } = offer.offeredSpace;

      const meta = await readProjectMeta(bowman);
      const known = meta.linkedRepos?.find(link => link.repoId === repoId);
      const link: LinkedRepo = { ...known, repoId, name, host };
      meta.linkedRepos = [...(meta.linkedRepos ?? []).filter(other => other.repoId !== repoId), link];
      await writeProjectMeta(bowman, meta);

      const edge = {
        repoId,
        relativePosition: idea.supportingRepos?.find(other => other.repoId === repoId)?.relativePosition ?? offer.relativePosition ?? getRandomRelativePosition(),
        weight: input.weight ?? 1,
        ...(offer.text ? { hypothesis: offer.text } : {})
      };
      const accepted = { ...idea, supportingRepos: [...(idea.supportingRepos ?? []).filter(other => other.repoId !== repoId), edge] };
      await writeIdea(bowman, accepted);
      updateIdeaInIndex(bowman, accepted);
      await run(() => removeNote(space, offer.id, () => true));
      return { ideaId: idea.id };
    }),

  // New notes on the spaces the viewer owns or writes, newest first: what the
  // header's badge shows. A note whose idea is gone is left out.
  recent: delayedProcedure.query(async ({ ctx }) => {
    const viewer = viewerOf(ctx);
    if (viewer.id === null) return [];
    const mine = listSpaces().filter(space => rightOn(space, viewer) !== 'read');
    const all = (await Promise.all(mine.map(async space =>
      shown((await listNotes(space)).filter(note => note.author !== viewer.id), space, viewer).map(note => ({ ...note, slug: space.slug, space }))
    ))).flat().sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, RECENT_LIMIT);
    const withIdeas = await Promise.all(all.map(async ({ space, ...note }) => {
      const idea = await readIdea(spaceBowmanPath(space), note.ideaId).catch(() => null);
      return idea && { ...note, ideaText: idea.text };
    }));
    return withIdeas.flatMap(note => note ?? []);
  })
});
