import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import FormModalShell from '../FormModalShell.vue'

describe('FormModalShell', () => {
  const escape = (target: Element = document.body) => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }

  it('requests close on Escape wherever focus is, and marks the key handled', () => {
    const requestClose = vi.fn()
    const wrapper = mount(FormModalShell, { props: { show: true, title: 'Test', onRequestClose: requestClose }, attachTo: document.body })

    expect(escape().defaultPrevented).toBe(true)
    expect(requestClose).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('in a textarea the first Escape only leaves the field and says so; the second closes', async () => {
    const requestClose = vi.fn()
    const wrapper = mount({
      components: { FormModalShell },
      template: `<FormModalShell :show="true" title="Test" @request-close="requestClose"><textarea class="notes" /></FormModalShell>`,
      setup: () => ({ requestClose })
    }, { attachTo: document.body })
    const notes = wrapper.find('.notes').element as HTMLTextAreaElement
    notes.focus()

    escape(notes)
    await nextTick()
    expect(requestClose).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(notes)
    expect(wrapper.text()).toContain('Esc again closes')

    escape()
    expect(requestClose).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('only the topmost open modal closes; a hidden one is skipped', () => {
    const lower = vi.fn()
    const upper = vi.fn()
    const hidden = vi.fn()
    const wrapper = mount({
      components: { FormModalShell },
      template: `
        <FormModalShell :show="true" title="Lower" @request-close="lower" />
        <FormModalShell :show="true" title="Upper" @request-close="upper" />
        <FormModalShell :show="false" title="Hidden" @request-close="hidden" />`,
      setup: () => ({ lower, upper, hidden })
    }, { attachTo: document.body })

    escape()
    expect(upper).toHaveBeenCalledTimes(1)
    expect(lower).not.toHaveBeenCalled()
    expect(hidden).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('a modal that handles Escape itself is left alone; its close button still closes', async () => {
    const requestClose = vi.fn()
    const wrapper = mount(FormModalShell, { props: { show: true, title: 'Test', closeOnEscape: false, onRequestClose: requestClose }, attachTo: document.body })

    escape()
    expect(requestClose).not.toHaveBeenCalled()
    await wrapper.find('.modal-header button[title="Close"]').trigger('click')
    expect(requestClose).toHaveBeenCalledTimes(1)
    wrapper.unmount()
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
