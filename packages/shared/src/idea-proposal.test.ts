import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IDEA_PROPOSAL_MAX_IDEAS,
  IdeaProposalSchema,
  flattenAimProposal,
  type ProposedAim,
} from './idea-proposal.js';

const leaf = (proposalId: string): ProposedAim => ({
  proposalId,
  text: proposalId,
  children: [],
});

test('validates and flattens an editable proposal tree deterministically', () => {
  const proposal = IdeaProposalSchema.parse({
    revision: 'draft-1',
    sourceText: 'Help me make the company economically stable',
    existingParentIds: [],
    assumptions: ['Start with one bounded offer'],
    questions: [],
    root: {
      proposalId: 'root',
      text: 'Reach economic stability',
      intrinsicValue: 10,
      children: [{
        weight: 2,
        explanation: 'Revenue tests the mission in reality',
        child: {
          proposalId: 'paid-diagnostic',
          text: 'Sell one paid diagnostic',
          cost: 2,
          children: [{ weight: 1, child: leaf('contact-owner') }],
        },
      }],
    },
  });

  const flattened = flattenAimProposal(proposal.root);
  assert.deepEqual(flattened.ideas.map(idea => idea.proposalId), [
    'root',
    'paid-diagnostic',
    'contact-owner',
  ]);
  assert.deepEqual(flattened.connections, [
    {
      parentProposalId: 'root',
      childProposalId: 'paid-diagnostic',
      weight: 2,
      explanation: 'Revenue tests the mission in reality',
    },
    {
      parentProposalId: 'paid-diagnostic',
      childProposalId: 'contact-owner',
      weight: 1,
    },
  ]);
});

test('rejects durable UUIDs, duplicate draft IDs, invalid weights, excess depth and excess size', () => {
  const base = {
    revision: 'draft-1',
    sourceText: 'A real goal',
    existingParentIds: [],
    assumptions: [],
    questions: [],
  };

  assert.equal(IdeaProposalSchema.safeParse({
    ...base,
    root: leaf('550e8400-e29b-41d4-a716-446655440000'),
  }).success, false);

  assert.equal(IdeaProposalSchema.safeParse({
    ...base,
    root: { ...leaf('same'), children: [{ weight: 1, child: leaf('same') }] },
  }).success, false);

  assert.equal(IdeaProposalSchema.safeParse({
    ...base,
    root: { ...leaf('root'), children: [{ weight: 0, child: leaf('child') }] },
  }).success, false);

  let tooDeep = leaf('depth-6');
  for (let depth = 5; depth >= 1; depth -= 1) {
    tooDeep = { ...leaf(`depth-${depth}`), children: [{ weight: 1, child: tooDeep }] };
  }
  assert.equal(IdeaProposalSchema.safeParse({ ...base, root: tooDeep }).success, false);

  const tooWide = {
    ...leaf('root'),
    children: Array.from({ length: IDEA_PROPOSAL_MAX_IDEAS }, (_, index) => ({
      weight: 1,
      child: leaf(`child-${index}`),
    })),
  };
  assert.equal(IdeaProposalSchema.safeParse({ ...base, root: tooWide }).success, false);
});
