import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentCommands from '../AgentCommands.vue'

describe('AgentCommands', () => {
  const stdio = { command: '/repo/packages/mcp/node_modules/.bin/tsx', args: ['/repo/packages/mcp/src/index.ts'], env: {} }

  it('without accounts gives the command that starts the MCP server, for all projects', () => {
    const wrapper = mount(AgentCommands, { props: { stdio } })
    expect(wrapper.find('pre').text()).toBe('claude mcp add --scope user aimparency -- /repo/packages/mcp/node_modules/.bin/tsx /repo/packages/mcp/src/index.ts')
  })

  it('names a backend on another address and quotes paths with spaces', async () => {
    const wrapper = mount(AgentCommands, { props: { stdio: { ...stdio, args: ['/my repo/index.ts'], env: { BACKEND_WS_URL: 'ws://localhost:4001' } } } })
    expect(wrapper.find('pre').text()).toBe("claude mcp add --scope user -e BACKEND_WS_URL=ws://localhost:4001 aimparency -- /repo/packages/mcp/node_modules/.bin/tsx '/my repo/index.ts'")
    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === 'Other')!.trigger('click')
    expect(JSON.parse(wrapper.find('pre').text())).toEqual({ mcpServers: { aimparency: { command: stdio.command, args: ['/my repo/index.ts'], env: { BACKEND_WS_URL: 'ws://localhost:4001' } } } })
  })
})
