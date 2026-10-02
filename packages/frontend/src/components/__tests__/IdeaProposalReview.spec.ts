import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { IdeaProposal } from 'shared'
import IdeaProposalReview from '../IdeaProposalReview.vue'
import { trpc } from '../../trpc'

vi.mock('../../trpc', () => ({
  trpc: {
    idea: {
      approveIdeaSubtree: { mutate: vi.fn() }
    }
  }
}))

const proposal = (): IdeaProposal => ({
  revision: 'r1',
  sourceText: 'Improve operations',
  existingParentIds: ['00000000-0000-4000-8000-000000000001'],
  assumptions: ['The workflow repeats weekly'],
  questions: [],
  root: {
    proposalId: 'root',
    text: 'Improve operations',
    children: [{
      weight: 2,
      explanation: 'Saves coordination time',
      child: {
        proposalId: 'child',
        text: 'Automate reminders',
        children: []
      }
    }]
  }
})

describe('IdeaProposalReview', () => {
  beforeEach(() => {
    vi.mocked(trpc.idea.approveIdeaSubtree.mutate).mockReset()
  })

  it('keeps edits transient and shows the exact approval summary', async () => {
    const wrapper = mount(IdeaProposalReview, {
      props: { show: true, projectPath: '/project/.bowman', proposal: proposal() }
    })

    expect(wrapper.text()).toContain('2 ideas and 2 connections')
    await wrapper.get('input').setValue('A better operations idea')
    expect(proposal().root.text).toBe('Improve operations')
    expect(trpc.idea.approveIdeaSubtree.mutate).not.toHaveBeenCalled()

    await wrapper.get('button.primary').trigger('click')
    expect(wrapper.text()).toContain('Nothing has been added to the graph yet.')
    expect(wrapper.text()).toContain('Add 2 ideas and 2 connections')
    expect(trpc.idea.approveIdeaSubtree.mutate).not.toHaveBeenCalled()
  })

  it('persists only after explicit approval and emits durable IDs', async () => {
    vi.mocked(trpc.idea.approveIdeaSubtree.mutate).mockResolvedValue({
      complete: true,
      replayed: false,
      rootIdeaId: '00000000-0000-4000-8000-000000000010',
      idMap: {
        root: '00000000-0000-4000-8000-000000000010',
        child: '00000000-0000-4000-8000-000000000011'
      },
      completedOperations: 3
    })
    const wrapper = mount(IdeaProposalReview, {
      props: { show: true, projectPath: '/project/.bowman', proposal: proposal() }
    })

    await wrapper.get('button.primary').trigger('click')
    await wrapper.get('button.primary').trigger('click')

    expect(trpc.idea.approveIdeaSubtree.mutate).toHaveBeenCalledOnce()
    expect(trpc.idea.approveIdeaSubtree.mutate).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: '/project/.bowman',
      revision: 'r1',
      proposal: expect.objectContaining({ revision: 'r1' }),
      idempotencyKey: expect.stringContaining('r1:')
    }))
    expect(wrapper.emitted('persisted')?.[0]?.[0]).toEqual({
      rootIdeaId: '00000000-0000-4000-8000-000000000010',
      idMap: {
        root: '00000000-0000-4000-8000-000000000010',
        child: '00000000-0000-4000-8000-000000000011'
      }
    })
  })

  it('can add and remove nested ideas while editing', async () => {
    const wrapper = mount(IdeaProposalReview, {
      props: { show: true, projectPath: '/project/.bowman', proposal: proposal() }
    })

    await wrapper.findAll('button').find(button => button.text() === 'Add supporting idea')!.trigger('click')
    expect(wrapper.text()).toContain('3 ideas and 3 connections')

    const removeButtons = wrapper.findAll('button.danger')
    await removeButtons[removeButtons.length - 1]!.trigger('click')
    expect(wrapper.text()).toContain('2 ideas and 2 connections')
  })
})
