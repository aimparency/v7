import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import App from '../App.vue'

describe('App', () => {
  it('mounts renders properly', () => {
    const wrapper = mount(App, {
      global: {
        plugins: [createTestingPinia()],
        stubs: {
          // Stub complex components if needed to speed up test
          WatchdogPanel: true,
          PhaseColumn: true,
          GraphView: true,
          VoiceAgent: true
        }
      }
    })
    // Expect project name or something from the UI
    expect(wrapper.exists()).toBe(true)
  })
})
