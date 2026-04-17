const FLUSH_AFTER_MS = 5000

type AggregateStat = {
  count: number
  sums: Record<string, number>
}

type TraceEntry = {
  t: number
  event: string
  details: Record<string, unknown>
}

let flushTimer: number | null = null
let startedAt: number | null = null
const aggregates = new Map<string, AggregateStat>()
const traceEntries: TraceEntry[] = []
let lastSummary = ''

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function timestamp() {
  return Math.round(now() * 100) / 100
}

function resetState() {
  if (flushTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(flushTimer)
  }
  flushTimer = null
  startedAt = null
  aggregates.clear()
  traceEntries.length = 0
  lastSummary = ''
}

function scheduleFlush() {
  if (typeof window === 'undefined' || flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushSummary()
  }, FLUSH_AFTER_MS)
}

function getNumericDetails(details: Record<string, unknown>) {
  const numeric: Record<string, number> = {}
  for (const [key, value] of Object.entries(details)) {
    if (key !== 't' && typeof value === 'number' && Number.isFinite(value)) {
      numeric[key] = value
    }
  }
  return numeric
}

function record(event: string, details: Record<string, unknown>) {
  if (!isPerfLoggingEnabled()) return
  if (startedAt === null) {
    startedAt = now()
  }
  scheduleFlush()

  traceEntries.push({
    t: timestamp(),
    event,
    details
  })

  const stat = aggregates.get(event) ?? { count: 0, sums: {} }
  stat.count += 1

  for (const [key, value] of Object.entries(getNumericDetails(details))) {
    stat.sums[key] = (stat.sums[key] ?? 0) + value
  }

  aggregates.set(event, stat)
}

function formatTraceDetails(details: Record<string, unknown>) {
  const parts: string[] = []
  const append = (label: string, key: string) => {
    const value = details[key]
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${label}=${String(value)}`)
    }
  }

  append('c', 'columnIndex')
  append('p', 'phaseId')
  append('par', 'parentId')
  append('sel', 'selectedPhaseId')
  append('n', 'phaseCount')
  append('n', 'entries')
  append('a', 'aimCount')
  append('m', 'commitmentCount')
  append('d', 'durationMs')
  append('ac', 'activeColumn')
  append('ws', 'windowStart')
  append('wz', 'windowSize')
  append('mx', 'maxColumn')

  return parts.join(',')
}

function buildTrace() {
  return traceEntries
    .map(({ t, event, details }) => {
      const detailString = formatTraceDetails(details)
      return detailString ? `${t}:${event}(${detailString})` : `${t}:${event}`
    })
    .join(' | ')
}

function buildSummary() {
  const parts = ['[PerfSummary]']

  const trace = buildTrace()
  if (trace) {
    parts.push(`trace=${trace}`)
  }

  for (const [event, stat] of aggregates.entries()) {
    const fields = [`${event}#${stat.count}`]
    for (const [key, value] of Object.entries(stat.sums)) {
      const rounded = Math.round(value * 100) / 100
      fields.push(`${key}Σ=${rounded}`)
    }
    parts.push(fields.join(' '))
  }

  return parts.join(' | ')
}

function flushSummary() {
  if (!isPerfLoggingEnabled()) return
  flushTimer = null
  lastSummary = buildSummary()
  console.log(lastSummary)
}

export function isPerfLoggingEnabled() {
  if (typeof window === 'undefined') return false
  return hasQueryFlag('perf')
}

export function hasQueryFlag(flag: string) {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.has(flag)
}

export function clearPerfLogging() {
  if (typeof console !== 'undefined' && console.clear) {
    console.clear()
  }
  resetState()
}

export function installPerfLoggingControls() {
  if (typeof window === 'undefined') return
  if (isPerfLoggingEnabled()) {
    scheduleFlush()
  }
}

export function perfLog(event: string, details: Record<string, unknown> = {}) {
  record(event, { t: timestamp(), ...details })
}

export async function perfAsync<T>(
  event: string,
  details: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  if (!isPerfLoggingEnabled()) {
    return await fn()
  }

  const opStartedAt = now()
  record(`${event}:start`, details)
  try {
    const result = await fn()
    record(`${event}:done`, {
      ...details,
      durationMs: Math.round((now() - opStartedAt) * 100) / 100
    })
    return result
  } catch (error) {
    record(`${event}:error`, {
      ...details,
      durationMs: Math.round((now() - opStartedAt) * 100) / 100
    })
    throw error
  }
}
