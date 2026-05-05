import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FormModalShell from '../FormModalShell.vue'

describe('FormModalShell', () => {
  it('requests close on Escape and stops propagation to parent handlers', () => {
    const parentKeydown = vi.fn()
    const requestClose = vi.fn()
    const wrapper = mount({
      components: { FormModalShell },
      template: `
        <div class="parent" @keydown="parentKeydown">
          <FormModalShell :show="true" title="Test" @request-close="requestClose" />
        </div>
      `,
      setup: () => ({ parentKeydown, requestClose })
    })

    wrapper.find('.modal-overlay').element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    }))

    expect(requestClose).toHaveBeenCalledTimes(1)
    expect(parentKeydown).not.toHaveBeenCalled()
  })
})
