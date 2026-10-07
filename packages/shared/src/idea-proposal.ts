import { z } from 'zod';

export const IDEA_PROPOSAL_MAX_IDEAS = 30;
export const IDEA_PROPOSAL_MAX_DEPTH = 5;

export const ProposedIdeaStatusSchema = z.enum(['open', 'unclear', 'human-dependent']);

export type ProposedIdea = {
  proposalId: string;
  text: string;
  description?: string;
  children: ProposedConnection[];
  intrinsicValue?: number;
  valueRationale?: string;
  cost?: number;
  status?: z.infer<typeof ProposedIdeaStatusSchema>;
  statusComment?: string;
  tags?: string[];
};

export type ProposedConnection = {
  child: ProposedIdea;
  weight: number;
  hypothesis?: string;
};

export const ProposedIdeaSchema: z.ZodType<ProposedIdea> = z.lazy(() => z.object({
  // Draft-local identifier only. Deliberately rejects UUID-shaped values so a
  // proposal cannot smuggle a durable idea identity into approval.
  proposalId: z.string().min(1).max(100).refine(
    value => !z.string().uuid().safeParse(value).success,
    'proposalId must be draft-local, not a durable UUID',
  ),
  text: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5_000).optional(),
  children: z.array(z.object({
    child: ProposedIdeaSchema,
    weight: z.number().finite().positive(),
    hypothesis: z.string().trim().max(1_000).optional(),
  })),
  intrinsicValue: z.number().finite().nonnegative().optional(),
  valueRationale: z.string().optional(),
  cost: z.number().finite().positive().optional(),
  status: ProposedIdeaStatusSchema.optional(),
  statusComment: z.string().trim().max(1_000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
}));

export const IdeaProposalSchema = z.object({
  revision: z.string().trim().min(1).max(200),
  sourceText: z.string().trim().min(1).max(10_000),
  root: ProposedIdeaSchema,
  existingParentIds: z.array(z.string().uuid()).max(20).default([]),
  phaseId: z.string().uuid().optional(),
  assumptions: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  questions: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
}).superRefine((proposal, context) => {
  const ids = new Set<string>();
  let count = 0;

  const visit = (idea: ProposedIdea, depth: number) => {
    count += 1;
    if (count > IDEA_PROPOSAL_MAX_IDEAS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['root'],
        message: `Proposal exceeds ${IDEA_PROPOSAL_MAX_IDEAS} ideas`,
      });
      return;
    }
    if (depth > IDEA_PROPOSAL_MAX_DEPTH) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['root'],
        message: `Proposal exceeds depth ${IDEA_PROPOSAL_MAX_DEPTH}`,
      });
      return;
    }
    if (ids.has(idea.proposalId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['root'],
        message: `Duplicate proposalId: ${idea.proposalId}`,
      });
      return;
    }
    ids.add(idea.proposalId);
    for (const connection of idea.children) visit(connection.child, depth + 1);
  };

  visit(proposal.root, 1);
});

export type IdeaProposal = z.infer<typeof IdeaProposalSchema>;

export type FlatProposedIdea = Omit<ProposedIdea, 'children'>;

export type FlatProposedConnection = {
  parentProposalId: string;
  childProposalId: string;
  weight: number;
  hypothesis?: string;
};

export function flattenIdeaProposal(root: ProposedIdea): {
  ideas: FlatProposedIdea[];
  connections: FlatProposedConnection[];
} {
  const ideas: FlatProposedIdea[] = [];
  const connections: FlatProposedConnection[] = [];

  const visit = (idea: ProposedIdea) => {
    const { children, ...flatIdea } = idea;
    ideas.push(flatIdea);
    for (const connection of children) {
      connections.push({
        parentProposalId: idea.proposalId,
        childProposalId: connection.child.proposalId,
        weight: connection.weight,
        ...(connection.hypothesis ? { hypothesis: connection.hypothesis } : {}),
      });
      visit(connection.child);
    }
  };

  visit(root);
  return { ideas, connections };
}
