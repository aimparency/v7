import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AimProposalEntry from '../AimProposalEntry.vue'
import { trpc } from '../../trpc'

vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      approveAimSubtree: { mutate: vi.fn() },
      proposeAimSubtree: { mutate: vi.fn() }
    }
  }
}))

describe('AimProposalEntry', () => {
  it('turns ordinary text into a transient editable root without writing', async () => {
    const wrapper = mount(AimProposalEntry, {
      props: { show: true, projectPath: '/project' }
    })

    const create = wrapper.findAll('button').find(button => button.text() === 'Start manually')!
    expect(create.attributes('disabled')).toBeDefined()

    await wrapper.get('textarea').setValue('Make festival volunteer coordination reliable')
    await create.trigger('click')

    expect(wrapper.text()).toContain('Review proposed aims')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Make festival volunteer coordination reliable')
    expect(wrapper.text()).toContain('1 aim and 0 connections')
  })

  it('opens a validated model proposal without persisting it', async () => {
    vi.mocked(trpc.aim.proposeAimSubtree.mutate).mockResolvedValue({
      revision: 'model-r1',
      sourceText: 'Improve operations',
      existingParentIds: [],
      assumptions: [],
      questions: [],
      root: {
        proposalId: 'draft-1',
        text: 'Reliable operations',
        children: []
      }
    })
    const wrapper = mount(AimProposalEntry, {
      props: { show: true, projectPath: '/project' }
    })

    await wrapper.get('textarea').setValue('Improve operations')
    await wrapper.get('button.primary').trigger('click')

    expect(trpc.aim.proposeAimSubtree.mutate).toHaveBeenCalledWith({
      projectPath: '/project',
      transcript: 'Improve operations',
      existingParentIds: []
    })
    expect(wrapper.text()).toContain('Review proposed aims')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Reliable operations')
    expect(trpc.aim.approveAimSubtree.mutate).not.toHaveBeenCalled()
  })

  it('returns from the editor to text entry without closing the whole flow', async () => {
    const wrapper = mount(AimProposalEntry, {
      props: { show: true, projectPath: '/project' }
    })

    await wrapper.get('textarea').setValue('A goal')
    await wrapper.findAll('button').find(button => button.text() === 'Start manually')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click')

    expect(wrapper.text()).toContain('What do you want to achieve?')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
