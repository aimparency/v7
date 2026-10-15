import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from './toast'

describe('toast store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.useRealTimers())

  it('auto-dismisses info but keeps errors until dismissed', () => {
    const toasts = useToastStore()
    toasts.info('saved')
    toasts.error('Move failed', new Error('disk full'))

    vi.advanceTimersByTime(60_000)

    expect(toasts.toasts.map(toast => toast.message)).toEqual(['Move failed: disk full'])
    toasts.dismiss(toasts.toasts[0]!.id)
    expect(toasts.toasts).toEqual([])
  })

  it('counts repeats instead of stacking them, and caps the stack', () => {
    const toasts = useToastStore()
    toasts.error('Failed to save positions', new Error('offline'))
    toasts.error('Failed to save positions', new Error('offline'))
    expect(toasts.toasts).toHaveLength(1)
    expect(toasts.toasts[0]!.count).toBe(2)

    for (let index = 0; index < 10; index++) toasts.warning(`warning ${index}`)
    expect(toasts.toasts).toHaveLength(5)
    expect(toasts.toasts[4]!.message).toBe('warning 9')
  })
})
