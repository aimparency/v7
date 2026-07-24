import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { AimProposal } from 'shared'
import AimProposalReview from '../AimProposalReview.vue'
import { trpc } from '../../trpc'

vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      approveAimSubtree: { mutate: vi.fn() }
    }
  }
}))

const proposal = (): AimProposal => ({
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

describe('AimProposalReview', () => {
  beforeEach(() => {
    vi.mocked(trpc.aim.approveAimSubtree.mutate).mockReset()
  })

  it('keeps edits transient and shows the exact approval summary', async () => {
    const wrapper = mount(AimProposalReview, {
      props: { show: true, projectPath: '/project/.bowman', proposal: proposal() }
    })

    expect(wrapper.text()).toContain('2 aims and 2 connections')
    await wrapper.get('input').setValue('A better operations aim')
    expect(proposal().root.text).toBe('Improve operations')
    expect(trpc.aim.approveAimSubtree.mutate).not.toHaveBeenCalled()

    await wrapper.get('button.primary').trigger('click')
    expect(wrapper.text()).toContain('Nothing has been added to the graph yet.')
    expect(wrapper.text()).toContain('Add 2 aims and 2 connections')
    expect(trpc.aim.approveAimSubtree.mutate).not.toHaveBeenCalled()
  })

  it('persists only after explicit approval and emits durable IDs', async () => {
    vi.mocked(trpc.aim.approveAimSubtree.mutate).mockResolvedValue({
      complete: true,
      replayed: false,
      rootAimId: '00000000-0000-4000-8000-000000000010',
      idMap: {
        root: '00000000-0000-4000-8000-000000000010',
        child: '00000000-0000-4000-8000-000000000011'
      },
      completedOperations: 3
    })
    const wrapper = mount(AimProposalReview, {
      props: { show: true, projectPath: '/project/.bowman', proposal: proposal() }
    })

    await wrapper.get('button.primary').trigger('click')
    await wrapper.get('button.primary').trigger('click')

    expect(trpc.aim.approveAimSubtree.mutate).toHaveBeenCalledOnce()
    expect(trpc.aim.approveAimSubtree.mutate).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: '/project/.bowman',
      revision: 'r1',
      proposal: expect.objectContaining({ revision: 'r1' }),
      idempotencyKey: expect.stringContaining('r1:')
    }))
    expect(wrapper.emitted('persisted')?.[0]?.[0]).toEqual({
      rootAimId: '00000000-0000-4000-8000-000000000010',
      idMap: {
        root: '00000000-0000-4000-8000-000000000010',
        child: '00000000-0000-4000-8000-000000000011'
      }
    })
  })

  it('can add and remove nested aims while editing', async () => {
    const wrapper = mount(AimProposalReview, {
      props: { show: true, projectPath: '/project/.bowman', proposal: proposal() }
    })

    await wrapper.findAll('button').find(button => button.text() === 'Add supporting aim')!.trigger('click')
    expect(wrapper.text()).toContain('3 aims and 3 connections')

    const removeButtons = wrapper.findAll('button.danger')
    await removeButtons[removeButtons.length - 1]!.trigger('click')
    expect(wrapper.text()).toContain('2 aims and 2 connections')
  })
})
