export function surfaceMovementShares(fromRadius: number, intoRadius: number) {
  const fromSurface = Math.max(0, fromRadius) ** 2
  const intoSurface = Math.max(0, intoRadius) ** 2
  const totalSurface = fromSurface + intoSurface
  if (totalSurface === 0) return { from: 0.5, into: 0.5 }

  // Each node moves in inverse proportion to its own surface/mass.
  return {
    from: intoSurface / totalSurface,
    into: fromSurface / totalSurface
  }
}
