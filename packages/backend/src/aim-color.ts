const ROOT_AIM_COLOR = '#666666'

type Hsv = { h: number, s: number, v: number }

function hexToHsv(hex: string): Hsv {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = ((value >> 16) & 255) / 255
  const g = ((value >> 8) & 255) / 255
  const b = (value & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6)
    else if (max === g) h = 60 * ((b - r) / delta + 2)
    else h = 60 * ((r - g) / delta + 4)
  }
  return {
    h: (h + 360) % 360,
    s: max === 0 ? 0 : delta / max,
    v: max
  }
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const sector = Math.floor(h / 60) % 6
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x],
    [0, x, c], [x, 0, c], [c, 0, x]
  ][sector]!
  const channel = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function deriveChildAimColor(parentColor: string, siblingIndex: number): string {
  const parent = hexToHsv(parentColor)
  const direction = siblingIndex % 2 === 0 ? 1 : -1
  const step = 9 + Math.floor(siblingIndex / 2) * 4
  return hsvToHex({
    h: (parent.h + direction * step + 360) % 360,
    s: Math.min(0.72, Math.max(0.48, parent.s + 0.04)),
    v: Math.min(0.56, Math.max(0.42, parent.v - 0.025))
  })
}

export function defaultAimColor(parentColor?: string, siblingIndex = 0): string {
  return parentColor ? deriveChildAimColor(parentColor, siblingIndex) : ROOT_AIM_COLOR
}
