import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LayoutPreviewPanel from '../LayoutPreviewPanel.vue'
import type { LayoutChange } from '../../utils/autolayout'

const change = (parentId: string, childId: string): LayoutChange => ({ parentId, childId, relativePosition: [1, 0], shift: 1, relevance: 1 })

describe('LayoutPreviewPanel', () => {
  it('shows connection and file counts for the slider position', () => {
    const wrapper = mount(LayoutPreviewPanel, {
      props: { changes: [change('p1', 'a'), change('p1', 'b'), change('p2', 'c')], placed: 4, count: 2, positionsOnly: false }
    })
    expect(wrapper.text()).toContain('Connections changed: 2 of 3 (1 idea files)')
    expect(wrapper.text()).toContain('Unconnected ideas placed: 4')
  })

  it('changes no connections when only absolute positions are updated', async () => {
    const wrapper = mount(LayoutPreviewPanel, {
      props: { changes: [change('p1', 'a')], placed: 1, count: 1, positionsOnly: false, 'onUpdate:positionsOnly': (value: boolean) => wrapper.setProps({ positionsOnly: value }) }
    })
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(wrapper.text()).toContain('Connections changed: 0 of 1 (0 idea files)')
    expect(wrapper.find('input[type="range"]').attributes('disabled')).toBeDefined()
  })

  it('hides the slider and locks the option when no connection would change', () => {
    const wrapper = mount(LayoutPreviewPanel, { props: { changes: [], placed: 3, count: 0, positionsOnly: true } })
    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
    expect(wrapper.find('input[type="checkbox"]').attributes('disabled')).toBeDefined()
  })
})
