import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DEFAULT_URL = 'http://localhost:4000/'

function installWindow(url = DEFAULT_URL) {
  vi.stubGlobal('window', {
    location: new URL(url)
  })
}

describe('runtime-config', () => {
  beforeEach(() => {
    vi.resetModules()
    installWindow()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads resolved runtime config from /runtime-config.json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        frontendPort: 4400,
        backendHttpPort: 3400,
        backendWsPort: 3401,
        brokerHttpPort: 5400,
        brokerWsPort: 5401,
        processStartPort: 7400,
        generatedAt: '2026-03-24T12:00:00.000Z'
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { loadRuntimeConfig, getRuntimeConfig, buildWsUrl, buildHttpUrl } = await import('./runtime-config')

    const config = await loadRuntimeConfig()

    expect(fetchMock).toHaveBeenCalledWith('/runtime-config.json', { cache: 'no-store' })
    expect(config.backendWsPort).toBe(3401)
    expect(getRuntimeConfig().brokerHttpPort).toBe(5400)
    expect(buildWsUrl(config.backendWsPort)).toBe('ws://localhost:3401')
    expect(buildHttpUrl(config.backendHttpPort)).toBe('http://localhost:3400')
  })

  it('keeps defaults when runtime config fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')))

    const { loadRuntimeConfig, getRuntimeConfig } = await import('./runtime-config')

    const config = await loadRuntimeConfig()

    expect(config.frontendPort).toBe(4000)
    expect(config.backendHttpPort).toBe(3000)
    expect(getRuntimeConfig().brokerWsPort).toBe(5001)
  })
})
