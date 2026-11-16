import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LayoutPreviewPanel from '../LayoutPreviewPanel.vue'
import { DEFAULT_LAYOUT_SETTINGS, type LayoutChange } from '../../utils/autolayout'

const change = (parentId: string, childId: string): LayoutChange => ({ parentId, childId, relativePosition: [1, 0], shift: 1, relevance: 1 })
const base = { count: 0, settings: DEFAULT_LAYOUT_SETTINGS, saved: DEFAULT_LAYOUT_SETTINGS, solving: false }

describe('LayoutPreviewPanel', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('counts ideas (files) on the fader, each with all its changed connections', () => {
    const changes = [change('p1', 'a'), change('p2', 'c'), change('p1', 'b')]
    const one = mount(LayoutPreviewPanel, { props: { ...base, changes, count: 1 } })
    expect(one.text()).toContain('Ideas changed: 1 of 2 (2 connections)')
    expect(one.find('.fader input').attributes('max')).toBe('2')
    const both = mount(LayoutPreviewPanel, { props: { ...base, changes, count: 2 } })
    expect(both.text()).toContain('Ideas changed: 2 of 2 (3 connections)')
  })

  it('locks the fader when no connection would change', () => {
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, changes: [] } })
    expect(wrapper.find('.fader input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Ideas changed: 0 of 0 (0 connections)')
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
    expect(wrapper.emitted('update:settings')!.pop()![0]).toMatchObject({ semantic: 0.02 })
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
