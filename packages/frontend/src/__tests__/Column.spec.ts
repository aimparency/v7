import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Column from '../components/Column.vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'

vi.mock('../trpc', () => ({ trpc: {} }))
vi.mock('../components/Phase.vue', () => ({
  default: { props: ['phase', 'isSelected', 'isActive'], template: '<div class="mock-phase">{{ phase.name }}</div>' }
}))

// Lets queued rAF scrolls and deferred realigns run.
const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await nextTick()
}

describe('Column.vue auto-scroll', () => {
  let scrollTo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    scrollTo = vi.fn()
    Element.prototype.scrollTo = scrollTo as any
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  })

  afterEach(() => vi.unstubAllGlobals())

  const mountColumn = async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const phase = (id: string) => ({ id, name: id, parent: null, childPhaseIds: [], commitments: [] }) as any
    for (const id of ['first', 'second', 'third']) dataStore.phases[id] = phase(id)
    dataStore.meta = { rootPhaseIds: ['first', 'second', 'third'] }
    uiStore.activeColumn = 0
    uiStore.selectedEntryKeyByColumn[0] = 'phase:third'

    // ColumnsView passes the selection the same way.
    const Host = defineComponent(() => () => h(Column, {
      columnIndex: 0,
      isSelected: true,
      isActive: true,
      selectedPhaseIndex: uiStore.findSelectedPhaseIndex(0)
    }))
    mount(Host, { attachTo: document.body })
    await settle()
    scrollTo.mockClear()
    return { dataStore, uiStore }
  }

  it('scrolls when the selection is navigated to another entry', async () => {
    const { uiStore } = await mountColumn()
    await uiStore.selectPhase(0, 0, 'backward')
    await settle()
    expect(scrollTo).toHaveBeenCalled()
  })

  it('does not scroll toward the stand-in entry while a deleted selection is being replaced', async () => {
    const { dataStore, uiStore } = await mountColumn()

    // Pushes of a phase deletion: the owner stops listing it, then it is removed.
    dataStore.meta = { rootPhaseIds: ['first', 'second'] }
    await settle()
    delete dataStore.phases['third']
    await settle()
    expect(uiStore.findSelectedPhaseIndex(0)).toBe(0)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
