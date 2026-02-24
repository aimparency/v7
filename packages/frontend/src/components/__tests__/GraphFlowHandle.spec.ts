import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GraphFlowHandle from '../GraphFlowHandle.vue'
import { useMapStore } from '../../stores/map'

describe('GraphFlowHandle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('freezes the opposite aim when dragging the source handle', async () => {
    const wrapper = mount(GraphFlowHandle, {
      props: {
        link: {
          source: { id: 'source-aim', pos: [0, 0] },
          target: { id: 'target-aim', pos: [100, 0] },
          relativePosition: [0, 0]
        },
        sourcePos: [0, 0],
        targetPos: [100, 0],
        sourceR: 25,
        targetR: 25
      }
    })

    const mapStore = useMapStore()
    const handles = wrapper.findAll('circle.handle')
    await handles[0]!.trigger('mousedown')

    expect(mapStore.layouting).toBe(true)
    expect(mapStore.layoutCandidate?.activeAimId).toBe('source-aim')
    expect(mapStore.layoutCandidate?.frozenAimId).toBe('target-aim')
  })

  it('freezes the opposite aim when dragging the target handle', async () => {
    const wrapper = mount(GraphFlowHandle, {
      props: {
        link: {
          source: { id: 'source-aim', pos: [0, 0] },
          target: { id: 'target-aim', pos: [100, 0] },
          relativePosition: [0, 0]
        },
        sourcePos: [0, 0],
        targetPos: [100, 0],
        sourceR: 25,
        targetR: 25
      }
    })

    const mapStore = useMapStore()
    const handles = wrapper.findAll('circle.handle')
    await handles[1]!.trigger('mousedown')

    expect(mapStore.layouting).toBe(true)
    expect(mapStore.layoutCandidate?.activeAimId).toBe('target-aim')
    expect(mapStore.layoutCandidate?.frozenAimId).toBe('source-aim')
  })
})
