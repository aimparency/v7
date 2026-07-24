const MAX_CANVAS_PIXEL_RATIO = 3

export function canvasPixelRatio(devicePixelRatio?: number): number {
  const ratio = devicePixelRatio ??
    (typeof window === 'undefined' ? 1 : window.devicePixelRatio)

  if (!Number.isFinite(ratio) || ratio <= 0) return 1
  return Math.min(ratio, MAX_CANVAS_PIXEL_RATIO)
}
