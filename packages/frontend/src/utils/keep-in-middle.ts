/** Scrolls `container` just enough that `item` lies within its middle two thirds. */
export function keepInMiddle(container: HTMLElement, item: HTMLElement) {
  const box = container.getBoundingClientRect()
  const rect = item.getBoundingClientRect()
  const margin = box.height / 6
  const above = box.top + margin - rect.top
  const below = rect.bottom - (box.bottom - margin)
  if (above > 0) container.scrollTop -= above
  else if (below > 0) container.scrollTop += below
}
