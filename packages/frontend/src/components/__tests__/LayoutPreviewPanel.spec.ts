import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LayoutPreviewPanel from '../LayoutPreviewPanel.vue'
import { DEFAULT_LAYOUT_SETTINGS, type LayoutChange } from '../../utils/autolayout'

const change = (parentId: string, childId: string): LayoutChange => ({ parentId, childId, relativePosition: [1, 0], shift: 1, relevance: 1 })
const base = { placed: 0, count: 0, positionsOnly: false, settings: DEFAULT_LAYOUT_SETTINGS, saved: DEFAULT_LAYOUT_SETTINGS, solving: false }

describe('LayoutPreviewPanel', () => {
  it('shows connection and file counts for the fader position', () => {
    const wrapper = mount(LayoutPreviewPanel, {
      props: { ...base, changes: [change('p1', 'a'), change('p1', 'b'), change('p2', 'c')], placed: 4, count: 2 }
    })
    expect(wrapper.text()).toContain('Connections changed: 2 of 3 (1 idea files)')
    expect(wrapper.text()).toContain('Unconnected ideas placed: 4')
  })

  it('changes no connections when only absolute positions are updated', async () => {
    const wrapper = mount(LayoutPreviewPanel, {
      props: { ...base, changes: [change('p1', 'a')], count: 1, 'onUpdate:positionsOnly': (value: boolean) => wrapper.setProps({ positionsOnly: value }) }
    })
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(wrapper.text()).toContain('Connections changed: 0 of 1 (0 idea files)')
    expect(wrapper.find('.fader input').attributes('disabled')).toBeDefined()
  })

  it('locks the fader and the option when no connection would change', () => {
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, changes: [], placed: 3 } })
    expect(wrapper.find('.fader input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('input[type="checkbox"]').attributes('disabled')).toBeDefined()
    expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('slides a weight logarithmically around its default', async () => {
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, changes: [] } })
    const memory = wrapper.findAll('.settings input')[1]!
    expect(Number((memory.element as HTMLInputElement).value)).toBeCloseTo(0.5)
    await memory.setValue(1)
    expect(wrapper.emitted('update:settings')!.pop()![0]).toMatchObject({ memory: 10 * DEFAULT_LAYOUT_SETTINGS.memory })
  })

  it('warns when the settings differ from the saved ones and resets to them', async () => {
    const saved = { ...DEFAULT_LAYOUT_SETTINGS, spacing: 4.5 }
    const wrapper = mount(LayoutPreviewPanel, { props: { ...base, changes: [], saved } })
    expect(wrapper.text()).toContain('Differs from the saved settings')
    await wrapper.findAll('button').find(button => button.text() === 'Reset')!.trigger('click')
    expect(wrapper.emitted('update:settings')!.pop()![0]).toEqual(saved)
  })
})
