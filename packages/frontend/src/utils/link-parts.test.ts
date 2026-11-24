import { describe, it, expect } from 'vitest'
import { linkParts } from './link-parts'

describe('linkParts', () => {
  it('splits out web links and leaves sentence punctuation as text', () => {
    expect(linkParts('Draft: https://mail.example.com/d/1. Send (see https://x.org/a_b)')).toEqual([
      { text: 'Draft: ' },
      { text: 'https://mail.example.com/d/1', href: 'https://mail.example.com/d/1' },
      { text: '. Send (see ' },
      { text: 'https://x.org/a_b', href: 'https://x.org/a_b' },
      { text: ')' }
    ])
    expect(linkParts('no links')).toEqual([{ text: 'no links' }])
  })
})
