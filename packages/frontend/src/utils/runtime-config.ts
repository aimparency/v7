const DEFAULT_HOST = 'localhost'
const DEFAULT_RUNTIME_CONFIG = {
  frontendPort: Number.parseInt(process.env.PORT_FRONTEND || '4000', 10),
  backendHttpPort: Number.parseInt(process.env.PORT_BACKEND_HTTP || '3000', 10),
  backendWsPort: Number.parseInt(process.env.PORT_BACKEND_WS || '3001', 10),
  brokerHttpPort: Number.parseInt(process.env.PORT_BROKER_HTTP || '5000', 10),
  brokerWsPort: Number.parseInt(process.env.PORT_BROKER_WS || '5001', 10),
  processStartPort: Number.parseInt(process.env.PORT_PROCESS_START || '7000', 10),
}

export type RuntimeConfig = typeof DEFAULT_RUNTIME_CONFIG & {
  generatedAt?: string
}

let runtimeConfig: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG }

function getLocation(): Location | undefined {
  return typeof window !== 'undefined' ? window.location : undefined
}

function getBrowserHost(): string {
  return getLocation()?.hostname || DEFAULT_HOST
}

function getHttpProtocol(): 'http:' | 'https:' {
  return getLocation()?.protocol === 'https:' ? 'https:' : 'http:'
}

function getWsProtocol(): 'ws:' | 'wss:' {
  return getHttpProtocol() === 'https:' ? 'wss:' : 'ws:'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readPort(value: unknown, fallback: number): number {
  const port = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(port) && port > 0 ? port : fallback
}

function normalizeRuntimeConfig(value: unknown): RuntimeConfig {
  if (!isRecord(value)) {
    return { ...DEFAULT_RUNTIME_CONFIG }
  }

  return {
    frontendPort: readPort(value.frontendPort, DEFAULT_RUNTIME_CONFIG.frontendPort),
    backendHttpPort: readPort(value.backendHttpPort, DEFAULT_RUNTIME_CONFIG.backendHttpPort),
    backendWsPort: readPort(value.backendWsPort, DEFAULT_RUNTIME_CONFIG.backendWsPort),
    brokerHttpPort: readPort(value.brokerHttpPort, DEFAULT_RUNTIME_CONFIG.brokerHttpPort),
    brokerWsPort: readPort(value.brokerWsPort, DEFAULT_RUNTIME_CONFIG.brokerWsPort),
    processStartPort: readPort(value.processStartPort, DEFAULT_RUNTIME_CONFIG.processStartPort),
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : undefined,
  }
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (typeof window === 'undefined') {
    return runtimeConfig
  }

  try {
    const response = await fetch('/runtime-config.json', { cache: 'no-store' })
    if (!response.ok) {
      return runtimeConfig
    }

    runtimeConfig = normalizeRuntimeConfig(await response.json())
  } catch {
    // Keep build-time defaults when runtime config is unavailable.
  }

  return runtimeConfig
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig
}

export function buildHttpUrl(port: string | number): string {
  return `${getHttpProtocol()}//${getBrowserHost()}:${port}`
}

export function buildWsUrl(port: string | number): string {
  return `${getWsProtocol()}//${getBrowserHost()}:${port}`
}
