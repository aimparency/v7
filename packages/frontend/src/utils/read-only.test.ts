import { afterEach, describe, expect, it } from 'vitest'
import { createTRPCProxyClient, type TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import { createPinia, setActivePinia } from 'pinia'
import type { AppRouter } from 'backend'
import { readOnlyGuardLink, setProjectAccess } from './read-only'
import { useToastStore } from '../stores/toast'

const REASON = 'This project is open read-only. Its ideas, phases and settings cannot be changed here.'

function client() {
  const sent: string[] = []
  const backend: TRPCLink<AppRouter> = () => ({ op }) => observable((observer) => {
    sent.push(op.path)
    observer.next({ result: { type: 'data', data: null } } as never)
    observer.complete()
  })
  return { sent, trpc: createTRPCProxyClient<AppRouter>({ links: [readOnlyGuardLink, backend] }) }
}

describe('readOnlyGuardLink', () => {
  afterEach(() => setProjectAccess('/repo', null))

  it('refuses space changes of a read-only project before they are sent', async () => {
    const { sent, trpc } = client()
    setProjectAccess('/repo', REASON)

    await expect(trpc.idea.update.mutate({ space: '/repo/.bowman', ideaId: 'a', idea: {} } as never)).rejects.toThrow(REASON)
    await trpc.idea.list.query({ space: '/repo' } as never) // reading is fine
    await trpc.phase.setCursor.mutate({ space: '/repo', cursors: {}, activeLevel: 0 }) // viewer position
    await trpc.notes.add.mutate({ space: '/repo', ideaId: 'a', kind: 'note', text: 'x' } as never) // the guests' layer: the server decides
    await trpc.idea.update.mutate({ space: '/other', ideaId: 'a', idea: {} } as never) // other projects untouched

    expect(sent).toEqual(['idea.list', 'phase.setCursor', 'notes.add', 'idea.update'])
  })

  it('lets everything through once the project is writable again', async () => {
    const { sent, trpc } = client()
    setProjectAccess('/repo', REASON)
    setProjectAccess('/repo/', null)
    await trpc.idea.update.mutate({ space: '/repo', ideaId: 'a', idea: {} } as never)
    expect(sent).toEqual(['idea.update'])
  })

  it('answers refused edits with a plain warning instead of an error', async () => {
    setActivePinia(createPinia())
    const toasts = useToastStore()
    const { trpc } = client()
    setProjectAccess('/repo', REASON)

    await trpc.idea.update.mutate({ space: '/repo', ideaId: 'a', idea: {} } as never).catch(error => toasts.error('Failed to update idea', error))

    expect(toasts.toasts.map(toast => [toast.kind, toast.message])).toEqual([['warning', REASON]])
  })
})
