const LOW_PRIORITY_RGB = [11, 37, 69] as const
const HIGH_PRIORITY_RGB = [245, 158, 11] as const

function interpolateChannel(low: number, high: number, t: number) {
  return Math.round(low + (high - low) * t)
}

export function priorityColor(priority: number, maxFinitePriority: number): string {
  if (priority === Number.POSITIVE_INFINITY) return '#f59e0b'

  const denominator = Number.isFinite(maxFinitePriority) && maxFinitePriority > 0
    ? maxFinitePriority
    : 1
  const t = Math.max(0, Math.min(1, priority / denominator))

  const red = interpolateChannel(LOW_PRIORITY_RGB[0], HIGH_PRIORITY_RGB[0], t)
  const green = interpolateChannel(LOW_PRIORITY_RGB[1], HIGH_PRIORITY_RGB[1], t)
  const blue = interpolateChannel(LOW_PRIORITY_RGB[2], HIGH_PRIORITY_RGB[2], t)
  return `rgb(${red}, ${green}, ${blue})`
}
