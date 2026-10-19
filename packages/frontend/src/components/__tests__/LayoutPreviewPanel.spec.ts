import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LayoutPreviewPanel from '../LayoutPreviewPanel.vue'
import { DEFAULT_LAYOUT_SETTINGS, type LayoutChange } from '../../utils/autolayout'

const change = (parentId: string, childId: string): LayoutChange => ({ parentId, childId, relativePosition: [1, 0], shift: 1, relevance: 1 })
const base = { count: 0, settings: DEFAULT_LAYOUT_SETTINGS, saved: DEFAULT_LAYOUT_SETTINGS, solving: false }

describe('LayoutPreviewPanel', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows connection and file counts for the fader position', () => {
    const wrapper = mount(LayoutPreviewPanel, {
      props: { ...base, changes: [change('p1', 'a'), change('p1', 'b'), change('p2', 'c')], count: 2 }
    })
    expect(wrapper.text()).toContain('Connections changed: 2 of 3 (1 idea files)')
  })

  it('locks the fader when no connection would change', () => {
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, changes: [] } })
    expect(wrapper.find('.fader input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Connections changed: 0 of 0 (0 idea files)')
  })

  it('puts similarity first, apart from the connection solver', () => {
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, changes: [] } })
    const sections = wrapper.findAll('section')
    expect(sections[0]!.find('input[name=semantic]').exists()).toBe(true)
    expect(sections[1]!.find('input[name=semantic]').exists()).toBe(false)
  })

  it('slides a weight logarithmically over its range', async () => {
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, changes: [] } })
    const memory = wrapper.find('.settings input[name=memory]')
    expect(Number((memory.element as HTMLInputElement).value)).toBeCloseTo(Math.log(1 / 0.3) / Math.log(10 / 0.3))
    await memory.setValue(1)
    expect(wrapper.emitted('update:settings')!.pop()![0]).toMatchObject({ memory: 10 })
  })

  it('turns a weight whose range starts at 0 off at the left end', async () => {
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, settings: { ...DEFAULT_LAYOUT_SETTINGS, semantic: 0 }, changes: [] } })
    const semantic = wrapper.find('.settings input[name=semantic]')
    expect(Number((semantic.element as HTMLInputElement).value)).toBe(0)
    await semantic.setValue(0.5)
    expect(wrapper.emitted('update:settings')!.pop()![0]).toMatchObject({ semantic: 0.1 })
    await semantic.setValue(0)
    expect(wrapper.emitted('update:settings')!.pop()![0]).toMatchObject({ semantic: 0 })
  })

  it('asks to start again from the positions when the panel opened', async () => {
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, changes: [] } })
    await wrapper.findAll('button').find(button => button.text() === 'Reset positions')!.trigger('click')
    expect(wrapper.emitted('resetPositions')).toHaveLength(1)
  })

  it('warns when the settings differ from the saved ones and resets to them', async () => {
    const saved = { ...DEFAULT_LAYOUT_SETTINGS, spacing: 4.5 }
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, changes: [], saved } })
    expect(wrapper.text()).toContain('Differs from the saved settings')
    await wrapper.findAll('button').find(button => button.text() === 'Reset')!.trigger('click')
    expect(wrapper.emitted('update:settings')!.pop()![0]).toEqual(saved)
  })
})
