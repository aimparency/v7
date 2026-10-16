import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import CommitModal from '../CommitModal.vue'

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn().mockResolvedValue({ commit: 'abc1234' }) }))
vi.mock('../../trpc', () => ({ trpc: { git: { commit: { mutate } } } }))

const ideaId = '11111111-2222-3333-4444-555555555555'

describe('CommitModal', () => {
  it('lists code before graph files, names ideas, and commits only the checked paths with the message', async () => {
    const wrapper = mount(CommitModal, {
      props: {
        changes: [{ path: `.bowman/ideas/${ideaId}.json`, code: '??' }, { path: 'src/a.ts', code: ' M' }, { path: 'src/b.ts', code: ' D' }],
        lastCommitAt: null
      },
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          initialState: { project: { projectPath: '/p' }, data: { ideas: { [ideaId]: { id: ideaId, text: 'Commit from the UI' } } } }
        })]
      }
    })

    expect(wrapper.findAll('li .label').map(label => label.text())).toEqual(['src/a.ts', 'src/b.ts', 'idea: Commit from the UI'])
    expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined() // no message yet

    await wrapper.findAll('li input')[1]!.setValue(false)
    await wrapper.find('input:not([type=checkbox])').setValue('feat: commit dialog')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mutate).toHaveBeenCalledWith({ projectPath: '/p', paths: [`.bowman/ideas/${ideaId}.json`, 'src/a.ts'], message: 'feat: commit dialog' })
    expect(wrapper.emitted('committed')).toHaveLength(1)
  })
})
