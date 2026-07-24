import type { AimProposal } from 'shared'

export function createManualAimProposal(sourceText: string, source: 'text' | 'voice' = 'text'): AimProposal {
  const text = sourceText.trim()
  if (!text) throw new Error('A goal is required')

  return {
    revision: `${source}-${Date.now()}-${crypto.randomUUID()}`,
    sourceText: text,
    existingParentIds: [],
    assumptions: [],
    questions: [],
    root: {
      proposalId: 'root',
      text,
      children: []
    }
  }
}
