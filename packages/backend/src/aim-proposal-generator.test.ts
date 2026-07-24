import { describe, expect, it } from 'vitest';
import { buildAimProposalFromGenerated } from './aim-proposal-generator';

describe('buildAimProposalFromGenerated', () => {
  it('assigns deterministic draft-local IDs and preserves contribution structure', () => {
    const proposal = buildAimProposalFromGenerated({
      transcript: 'Make festival operations reliable',
      existingParentIds: ['00000000-0000-4000-8000-000000000001'],
      revision: 'test-revision',
      generated: {
        assumptions: ['Volunteer schedules are available'],
        questions: [],
        root: {
          text: 'Reliable festival operations',
          children: [{
            weight: 2,
            explanation: 'Prevents missed shifts',
            child: {
              text: 'Coordinate volunteers',
              children: []
            }
          }]
        }
      }
    });

    expect(proposal.root.proposalId).toBe('draft-1');
    expect(proposal.root.children[0]?.child.proposalId).toBe('draft-2');
    expect(proposal.root.children[0]?.weight).toBe(2);
    expect(proposal.existingParentIds).toEqual(['00000000-0000-4000-8000-000000000001']);
  });

  it('rejects generated trees beyond the shared proposal limits', () => {
    const chain = (depth: number): any => ({
      text: `Depth ${depth}`,
      children: depth === 0 ? [] : [{ weight: 1, child: chain(depth - 1) }]
    });
    expect(() => buildAimProposalFromGenerated({
      transcript: 'Too deep',
      existingParentIds: [],
      revision: 'test-revision',
      generated: { root: chain(6), assumptions: [], questions: [] }
    })).toThrow();
  });
});
