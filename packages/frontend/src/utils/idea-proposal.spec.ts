import { describe, expect, it, vi } from 'vitest'
import { createManualIdeaProposal } from './idea-proposal'

describe('createManualIdeaProposal', () => {
  it('creates the same proposal contract for text and voice input', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
    vi.spyOn(Date, 'now').mockReturnValue(123)

    const text = createManualIdeaProposal('  Reach economic stability  ', 'text')
    const voice = createManualIdeaProposal('  Reach economic stability  ', 'voice')

    expect(text).toEqual({
      ...voice,
      revision: 'text-123-00000000-0000-4000-8000-000000000001'
    })
    expect(voice.revision).toBe('voice-123-00000000-0000-4000-8000-000000000001')
    expect(voice.root.text).toBe('Reach economic stability')
    expect(voice.root.children).toEqual([])
  })

  it('rejects empty input', () => {
    expect(() => createManualIdeaProposal('   ')).toThrow('A goal is required')
  })
})
