// A column has settled once its scroll position and content height stayed the
// same for this many frames: the first reveal, its settle frame and the height
// measurements all show up as changes to them.
export const STABLE_FRAMES = 3
// Past this a column that keeps changing counts as settled: something in it
// animates, and the loading screen shouldn't wait for that.
export const MAX_FRAMES = 60

type Scrollable = Pick<Element, 'scrollTop' | 'scrollHeight'>

export function columnsSettleTracker() {
  const lastSignature = new Map<Scrollable, string>()
  const stableFrames = new Map<Scrollable, number>()
  let frames = 0

  // One frame's look at the columns; returns how many have settled.
  return (columns: Scrollable[]) => {
    frames++
    let settled = 0
    for (const column of columns) {
      const signature = `${column.scrollTop}:${column.scrollHeight}`
      const stable = lastSignature.get(column) === signature ? (stableFrames.get(column) ?? 0) + 1 : 0
      lastSignature.set(column, signature)
      stableFrames.set(column, stable)
      if (stable >= STABLE_FRAMES || frames >= MAX_FRAMES) settled++
    }
    return settled
  }
}

// Calls back on every frame until all columns settled. Returns a stop function.
export function watchColumnsSettle(
  getColumns: () => Scrollable[],
  onProgress: (settled: number, total: number) => void,
  onSettled: () => void
) {
  const track = columnsSettleTracker()
  let frame = requestAnimationFrame(function check() {
    const columns = getColumns()
    const settled = track(columns)
    onProgress(settled, columns.length)
    if (settled === columns.length) onSettled()
    else frame = requestAnimationFrame(check)
  })
  return () => cancelAnimationFrame(frame)
}
