// Some browsers (Firefox's browser.backspace_action) go back a page on
// Backspace outside a text field: one stray key after a field lost focus and
// the app is gone. Only the browser default is stopped; the app's own
// Backspace handlers still get the key.
const TEXT_FIELD = 'textarea, select, [contenteditable]:not([contenteditable=false]), input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=button], [type=submit], [type=reset], [type=file])'

export function isBrowserBackKey(event: KeyboardEvent): boolean {
  if (event.key !== 'Backspace') return false
  const target = event.target
  return !(target instanceof Element && target.closest(TEXT_FIELD))
}

export function blockBackspaceNavigation(target: Window = window): () => void {
  const block = (event: KeyboardEvent) => {
    if (isBrowserBackKey(event)) event.preventDefault()
  }
  target.addEventListener('keydown', block, true)
  return () => target.removeEventListener('keydown', block, true)
}
