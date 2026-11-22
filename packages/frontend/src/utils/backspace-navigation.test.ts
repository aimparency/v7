import { afterEach, describe, expect, it } from 'vitest'
import { blockBackspaceNavigation } from './backspace-navigation'

const press = (target: EventTarget, key = 'Backspace') => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('blockBackspaceNavigation', () => {
  let stop = () => {}
  afterEach(() => {
    stop()
    document.body.innerHTML = ''
  })

  it('stops the browser going back on Backspace outside text fields, but the app still sees the key', () => {
    stop = blockBackspaceNavigation()
    let seen = false
    window.addEventListener('keydown', () => { seen = true }, { once: true })
    expect(press(document.body).defaultPrevented).toBe(true)
    expect(seen).toBe(true)

    const checkbox = document.body.appendChild(document.createElement('input'))
    checkbox.type = 'checkbox'
    expect(press(checkbox).defaultPrevented).toBe(true)
  })

  it('leaves Backspace alone in text fields and other keys everywhere', () => {
    stop = blockBackspaceNavigation()
    for (const tag of ['textarea', 'input'] as const) {
      expect(press(document.body.appendChild(document.createElement(tag))).defaultPrevented).toBe(false)
    }
    const editable = document.body.appendChild(document.createElement('div'))
    editable.setAttribute('contenteditable', 'true')
    expect(press(editable).defaultPrevented).toBe(false)
    expect(press(document.body, 'Delete').defaultPrevented).toBe(false)
  })
})
