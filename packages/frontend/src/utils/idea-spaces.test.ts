import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTRPCProxyClient, type TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { AppRouter } from 'backend'
// Another server: what this page asks of it, by procedure and space.
const remoteCalls = vi.hoisted(() => [] as string[])
vi.mock('./remote-trpc', async (original) => ({
  ...await original<typeof import('./remote-trpc')>(),
  remoteUntyped: (origin: string) => ({
    mutation: async (path: string, input: { graph: string }) => { remoteCalls.push(`${origin} ${path} ${input.graph}`); return { id: 'made-there' } },
    query: async (path: string, input: { graph: string }) => { remoteCalls.push(`${origin} ${path} ${input.graph}`); return [] }
  })
}))
import { clearIdeaSpaces, ideaSpaceLink, setIdeaSpace } from './idea-spaces'
import { readOnlyGuardLink, setProjectAccess } from './read-only'

// What reaches the server: each request's procedure and the space it names.
function client() {
  const sent: string[] = []
  const backend: TRPCLink<AppRouter> = () => ({ op }) => observable((observer) => {
    sent.push(`${op.path} ${(op.input as { graph?: string }).graph}`)
    observer.next({ result: { type: 'data', data: null } } as never)
    observer.complete()
  })
  return { sent, trpc: createTRPCProxyClient<AppRouter>({ links: [ideaSpaceLink, readOnlyGuardLink, backend] }) }
}

describe('ideaSpaceLink', () => {
  afterEach(() => {
    clearIdeaSpaces()
    setProjectAccess('host', null)
  })

  it('sends what concerns an idea of a space opened in place to that space, even where the open space is read-only', async () => {
    const { sent, trpc } = client()
    setProjectAccess('host', 'This space is open read-only here.')
    setIdeaSpace('mine-1', 'cook-every-friday')
    setIdeaSpace('mine-2', 'cook-every-friday')

    await trpc.idea.update.mutate({ graph: 'host', ideaId: 'mine-1', idea: {} } as never)
    await trpc.idea.connectIdeas.mutate({ graph: 'host', parentIdeaId: 'mine-1', childIdeaId: 'mine-2' } as never)
    await trpc.idea.createFloatingIdea.mutate({ graph: 'host', idea: { text: 'Buy a pot' }, inheritColorFrom: 'mine-1' } as never)
    await trpc.idea.getMany.query({ graph: 'host', ideaIds: ['mine-1', 'mine-2'] } as never)
    await expect(trpc.idea.update.mutate({ graph: 'host', ideaId: 'theirs', idea: {} } as never)).rejects.toThrow(/read-only/)

    expect(sent).toEqual([
      'idea.update cook-every-friday',
      'idea.connectIdeas cook-every-friday',
      'idea.createFloatingIdea cook-every-friday',
      'idea.getMany cook-every-friday'
    ])
  })

  it('refuses to connect ideas of two spaces one by one', async () => {
    const { sent, trpc } = client()
    setIdeaSpace('mine', 'cook-every-friday')
    await expect(trpc.idea.connectIdeas.mutate({ graph: 'host', parentIdeaId: 'theirs', childIdeaId: 'mine' } as never)).rejects.toThrow(/two spaces/)
    expect(sent).toEqual([])
  })

  it('leaves requests about the open space alone', async () => {
    const { sent, trpc } = client()
    setIdeaSpace('mine', 'cook-every-friday')
    await trpc.idea.update.mutate({ graph: 'host', ideaId: 'theirs', idea: {} } as never)
    await trpc.phase.list.query({ graph: 'host' } as never)
    expect(sent).toEqual(['idea.update host', 'phase.list host'])
  })

  it('sends what concerns an idea of a space on another server to that server, by its slug there', async () => {
    const { sent, trpc } = client()
    remoteCalls.length = 0
    setProjectAccess('host', 'This space is open read-only here.')
    setIdeaSpace('far-1', 'https://other.example/spaces/garden')

    const made = await trpc.idea.createFloatingIdea.mutate({ graph: 'host', idea: { text: 'Plant' }, inheritColorFrom: 'far-1' } as never)
    await trpc.idea.getMany.query({ graph: 'host', ideaIds: ['far-1'] } as never)

    expect(made).toEqual({ id: 'made-there' })
    expect(remoteCalls).toEqual(['https://other.example idea.createFloatingIdea garden', 'https://other.example idea.getMany garden'])
    expect(sent).toEqual([])
  })
})
