import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import CommitModal from '../CommitModal.vue'

const { mutate, pushMutate } = vi.hoisted(() => ({
  mutate: vi.fn().mockResolvedValue({ commit: 'abc1234' }),
  pushMutate: vi.fn().mockResolvedValue({ pushed: 2 })
}))
vi.mock('../../trpc', () => ({ trpc: { git: { commit: { mutate }, push: { mutate: pushMutate } } } }))

const ideaId = '11111111-2222-3333-4444-555555555555'
const global = {
  plugins: [createTestingPinia({
    createSpy: vi.fn,
    initialState: { project: { projectPath: '/p' }, data: { ideas: { [ideaId]: { id: ideaId, text: 'Commit from the UI' } } } }
  })]
}

describe('CommitModal', () => {
  it('lists code before graph files, names ideas, and commits only the checked paths with the message', async () => {
    const wrapper = mount(CommitModal, {
      props: {
        changes: [{ path: `.bowman/ideas/${ideaId}.json`, code: '??' }, { path: 'src/a.ts', code: ' M' }, { path: 'src/b.ts', code: ' D' }],
        lastCommitAt: null,
        ahead: null // no upstream: no push option
      },
      global
    })
    expect(wrapper.find('.push').exists()).toBe(false)

    expect(wrapper.findAll('li .label').map(label => label.text())).toEqual(['src/a.ts', 'src/b.ts', 'idea: Commit from the UI'])
    expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined() // no message yet

    await wrapper.findAll('li input')[1]!.setValue(false)
    await wrapper.find('input:not([type=checkbox])').setValue('feat: commit dialog')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mutate).toHaveBeenCalledWith({ projectPath: '/p', paths: [`.bowman/ideas/${ideaId}.json`, 'src/a.ts'], message: 'feat: commit dialog' })
    expect(pushMutate).not.toHaveBeenCalled()
    expect(wrapper.emitted('committed')).toHaveLength(1)
  })

  it('commits and then pushes when the branch has an upstream', async () => {
    pushMutate.mockClear()
    const wrapper = mount(CommitModal, { props: { changes: [{ path: 'src/a.ts', code: ' M' }], lastCommitAt: null, ahead: 1 }, global })
    expect(wrapper.find('.push').text()).toContain('+1 earlier')
    await wrapper.find('input:not([type=checkbox])').setValue('feat: push')
    expect(wrapper.find('button[type=submit]').text()).toBe('Commit 1 file & push')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(pushMutate).toHaveBeenCalledWith({ projectPath: '/p' })
    expect(wrapper.emitted('committed')).toHaveLength(1)
  })

  it('only pushes when nothing is left to commit', async () => {
    mutate.mockClear()
    pushMutate.mockClear()
    const wrapper = mount(CommitModal, { props: { changes: [], lastCommitAt: null, ahead: 2 }, global })
    expect(wrapper.find('ul').exists()).toBe(false)
    expect(wrapper.find('button[type=submit]').text()).toBe('Push 2 commits')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(mutate).not.toHaveBeenCalled()
    expect(pushMutate).toHaveBeenCalledWith({ projectPath: '/p' })
    expect(wrapper.emitted('committed')).toHaveLength(1)
  })
})
