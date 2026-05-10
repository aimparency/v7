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

  it('lets child Escape handlers keep the modal open when they stop propagation', () => {
    const parentKeydown = vi.fn()
    const requestClose = vi.fn()
    const childEscape = vi.fn((event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
    })
    const wrapper = mount({
      components: { FormModalShell },
      template: `
        <div class="parent" @keydown="parentKeydown">
          <FormModalShell :show="true" title="Test" @request-close="requestClose">
            <textarea class="child-input" @keydown.esc="childEscape" />
          </FormModalShell>
        </div>
      `,
      setup: () => ({ parentKeydown, requestClose, childEscape })
    })

    wrapper.find('.child-input').element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    }))

    expect(childEscape).toHaveBeenCalledTimes(1)
    expect(requestClose).not.toHaveBeenCalled()
    expect(parentKeydown).not.toHaveBeenCalled()
  })
})
