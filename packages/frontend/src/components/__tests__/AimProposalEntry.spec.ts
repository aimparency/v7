import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AimProposalEntry from '../AimProposalEntry.vue'

vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      approveAimSubtree: { mutate: vi.fn() }
    }
  }
}))

describe('AimProposalEntry', () => {
  it('turns ordinary text into a transient editable root without writing', async () => {
    const wrapper = mount(AimProposalEntry, {
      props: { show: true, projectPath: '/project' }
    })

    const create = wrapper.get('button.primary')
    expect(create.attributes('disabled')).toBeDefined()

    await wrapper.get('textarea').setValue('Make festival volunteer coordination reliable')
    await create.trigger('click')

    expect(wrapper.text()).toContain('Review proposed aims')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Make festival volunteer coordination reliable')
    expect(wrapper.text()).toContain('1 aim and 0 connections')
  })

  it('returns from the editor to text entry without closing the whole flow', async () => {
    const wrapper = mount(AimProposalEntry, {
      props: { show: true, projectPath: '/project' }
    })

    await wrapper.get('textarea').setValue('A goal')
    await wrapper.get('button.primary').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click')

    expect(wrapper.text()).toContain('What do you want to achieve?')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
