const LOW_RGB = [11, 37, 69] as const
const NEUTRAL_RGB = [148, 163, 184] as const
const HIGH_RGB = [245, 158, 11] as const

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value))

export function priorityLogMagnitude(priorities: number[]): number {
  const magnitudes = priorities
    .filter(priority => Number.isFinite(priority) && priority > 0)
    .map(priority => Math.abs(Math.log(priority)))
    .filter(magnitude => magnitude > 0)
    .sort((a, b) => a - b)
  if (magnitudes.length === 0) return 1
  const index = Math.ceil(magnitudes.length * 0.95) - 1
  return magnitudes[clamp(index, 0, magnitudes.length - 1)] || 1
}

function interpolate(from: readonly number[], to: readonly number[], amount: number): string {
  const channels = from.map((channel, index) =>
    Math.round(channel + (to[index]! - channel) * amount))
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`
}

export function priorityColor(priority: number, logMagnitude: number): string {
  if (priority === 0) return interpolate(LOW_RGB, NEUTRAL_RGB, 0)
  if (!Number.isFinite(priority) || priority < 0) return interpolate(LOW_RGB, NEUTRAL_RGB, 0)
  const magnitude = Number.isFinite(logMagnitude) && logMagnitude > 0 ? logMagnitude : 1
  const normalized = clamp(Math.log(priority) / magnitude, -1, 1)
  return normalized < 0
    ? interpolate(LOW_RGB, NEUTRAL_RGB, normalized + 1)
    : interpolate(NEUTRAL_RGB, HIGH_RGB, normalized)
}
