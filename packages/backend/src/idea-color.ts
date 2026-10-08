const ROOT_IDEA_COLOR = '#666666'

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
  const colors: Array<[number, number, number]> = [
    [c, x, 0], [x, c, 0], [0, c, x],
    [0, x, c], [x, 0, c], [c, 0, x]
  ]
  const [r, g, b] = colors[sector]!
  const channel = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

// Keeps node fills in a band where the light node text stays readable.
const clampSaturation = (s: number) => Math.min(0.72, Math.max(0.4, s))
const clampValue = (v: number) => Math.min(0.56, Math.max(0.38, v))

// A child takes its parent's color shifted by up to ±deviation of each HSV range,
// so branches of the graph stay similarly colored. Grey parents have no hue to
// inherit; their children start a new branch with a random hue.
export function deriveChildIdeaColor(parentColor: string, deviation = 0.05, random = Math.random): string {
  const parent = hexToHsv(parentColor)
  const jitter = () => (random() * 2 - 1) * deviation
  if (parent.s < 0.15) {
    return hsvToHex({ h: random() * 360, s: 0.56, v: clampValue(parent.v) })
  }
  return hsvToHex({
    h: (parent.h + jitter() * 360 + 360) % 360,
    s: clampSaturation(parent.s + jitter()),
    v: clampValue(parent.v + jitter())
  })
}

export function defaultIdeaColor(parentColor?: string): string {
  return parentColor ? deriveChildIdeaColor(parentColor) : ROOT_IDEA_COLOR
}
