export interface StatusColorEntry {
  key: string
  color: string
}

export const WEBGL_NODE_BRIGHTNESS = 2 / 3

const FALLBACK_STATUS_HEX: Record<string, string> = {
  done: '#007700',
  open: '#00558e',
  cancelled: '#b20000',
  failed: '#b24747',
  partially: '#777700',
  unclear: '#b27300',
  archived: '#3b3b3b'
}

export function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  const r = result?.[1]
  const g = result?.[2]
  const b = result?.[3]
  if (!r || !g || !b) return [0.5, 0.5, 0.5]

  return [
    parseInt(r, 16) / 255,
    parseInt(g, 16) / 255,
    parseInt(b, 16) / 255
  ]
}

export function cssColorToRgb(color: string): [number, number, number] {
  const value = color.trim()

  if (value.startsWith('#')) {
    return hexToRgb(value)
  }

  const rgbMatch = /^rgba?\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:\s*,\s*[0-9]+(?:\.[0-9]+)?)?\s*\)$/i.exec(value)
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1])))
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2])))
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3])))
    return [r / 255, g / 255, b / 255]
  }

  return [0.5, 0.5, 0.5]
}

export function applyBrightness(
  rgb: [number, number, number],
  factor: number = WEBGL_NODE_BRIGHTNESS
): [number, number, number] {
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  return [
    clamp(rgb[0] * factor),
    clamp(rgb[1] * factor),
    clamp(rgb[2] * factor)
  ]
}

export function statusToColor(
  status: string,
  configuredStatuses?: StatusColorEntry[] | null
): [number, number, number] {
  const configured = configuredStatuses?.find((entry) => entry.key === status)?.color
  if (configured) return applyBrightness(cssColorToRgb(configured))

  const fallbackHex = FALLBACK_STATUS_HEX[status] ?? '#3b3b3b'
  return applyBrightness(cssColorToRgb(fallbackHex))
}
