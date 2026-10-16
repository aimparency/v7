import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { defineComponent, h } from 'vue'
import IdeasList from '../IdeasList.vue'

vi.mock('../../trpc', () => ({ trpc: {} }))

const DraggableStub = defineComponent({
  props: ['group'],
  setup: (props) => () => h('div', { class: 'draggable-stub', 'data-group': props.group })
})

const listProps = { ideas: [], phaseId: 'phase', columnIndex: 0, isActive: false, isSelected: false, ideaUiStates: {} }
const TwoLists = defineComponent({ setup: () => () => [h(IdeasList, listProps), h(IdeasList, listProps)] })

describe('IdeasList', () => {
  // Only moves within a list are saved, so a drop must not land in another list.
  it('gives every list its own drag group', () => {
    const wrapper = mount(TwoLists, {
      global: { plugins: [createTestingPinia({ createSpy: vi.fn })], stubs: { draggable: DraggableStub } }
    })
    const groups = wrapper.findAll('.draggable-stub').map(list => list.attributes('data-group'))
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatch(/^ideas-/)
    expect(groups[0]).not.toBe(groups[1])
  })
})
