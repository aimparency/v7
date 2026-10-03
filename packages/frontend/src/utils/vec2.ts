/* i need a simple float64 vec2 implementation that makes some operations easier */

export type T = [number, number]


export function fromValues(x: number, y: number) {
  return [x, y] as T
}

export function create() {
  return [0, 0] as T
}

/* comparison */

/* most operators work inplace */

export function add(out: T, a: T, b: T) {
  out[0] = a[0] + b[0]
  out[1] = a[1] + b[1]
}

export function sub(out: T, a: T, b: T) {
  out[0] = a[0] - b[0]
  out[1] = a[1] - b[1]
}

export function dist2(a: T, b: T) {
  return Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2)
}

export function dist(a: T, b: T) {
  return Math.sqrt(dist2(a, b))
}

export function scale(out: T, a: T, s: number) {
  out[0] = a[0] * s
  out[1] = a[1] * s
}

export function len2(a: T) {
  return a[0] * a[0] + a[1] * a[1]
}

export function len(a: T) {
  return Math.sqrt(len2(a))
}

export function clone(a: T) {
  return [a[0], a[1]] as T
}

export function mix(out: T, a: T, b: T, aWeight: number) {
  out[0] = a[0] * aWeight + b[0] * (1 - aWeight)
  out[1] = a[1] * aWeight + b[1] * (1 - aWeight)
}

/* the following cr-helpers create a vector for the operator result */

export function crAdd(a: T, b: T) {
  const r: T = [0, 0]
  add(r, a, b) 
  return r
}

export function crSub(a: T, b: T) {
  const r: T = [0, 0]
  sub(r, a, b) 
  return r
}

export function crScale(a: T, s: number) {
  const r: T = [0, 0]
  scale(r, a, s) 
  return r
}

export function crMix(a: T, b: T, aWeight: number) {
  const r: T = [0, 0]
  r[0] = a[0] * aWeight + b[0] * (1 - aWeight)
  r[1] = a[1] * aWeight + b[1] * (1 - aWeight)
  return r
}
