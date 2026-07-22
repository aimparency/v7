import { z } from 'zod';

export const AIM_PROPOSAL_MAX_AIMS = 30;
export const AIM_PROPOSAL_MAX_DEPTH = 5;

export const ProposedAimStatusSchema = z.enum(['open', 'unclear', 'human-dependent']);

export type ProposedAim = {
  proposalId: string;
  text: string;
  description?: string;
  children: ProposedConnection[];
  intrinsicValue?: number;
  cost?: number;
  status?: z.infer<typeof ProposedAimStatusSchema>;
  statusComment?: string;
  tags?: string[];
};

export type ProposedConnection = {
  child: ProposedAim;
  weight: number;
  explanation?: string;
};

export const ProposedAimSchema: z.ZodType<ProposedAim> = z.lazy(() => z.object({
  // Draft-local identifier only. Deliberately rejects UUID-shaped values so a
  // proposal cannot smuggle a durable aim identity into approval.
  proposalId: z.string().min(1).max(100).refine(
    value => !z.string().uuid().safeParse(value).success,
    'proposalId must be draft-local, not a durable UUID',
  ),
  text: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5_000).optional(),
  children: z.array(z.object({
    child: ProposedAimSchema,
    weight: z.number().finite().positive(),
    explanation: z.string().trim().max(1_000).optional(),
  })),
  intrinsicValue: z.number().finite().nonnegative().optional(),
  cost: z.number().finite().nonnegative().optional(),
  status: ProposedAimStatusSchema.optional(),
  statusComment: z.string().trim().max(1_000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
}));

export const AimProposalSchema = z.object({
  revision: z.string().trim().min(1).max(200),
  sourceText: z.string().trim().min(1).max(10_000),
  root: ProposedAimSchema,
  existingParentIds: z.array(z.string().uuid()).max(20).default([]),
  phaseId: z.string().uuid().optional(),
  assumptions: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  questions: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
}).superRefine((proposal, context) => {
  const ids = new Set<string>();
  let count = 0;

  const visit = (aim: ProposedAim, depth: number) => {
    count += 1;
    if (count > AIM_PROPOSAL_MAX_AIMS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['root'],
        message: `Proposal exceeds ${AIM_PROPOSAL_MAX_AIMS} aims`,
      });
      return;
    }
    if (depth > AIM_PROPOSAL_MAX_DEPTH) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['root'],
        message: `Proposal exceeds depth ${AIM_PROPOSAL_MAX_DEPTH}`,
      });
      return;
    }
    if (ids.has(aim.proposalId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['root'],
        message: `Duplicate proposalId: ${aim.proposalId}`,
      });
      return;
    }
    ids.add(aim.proposalId);
    for (const connection of aim.children) visit(connection.child, depth + 1);
  };

  visit(proposal.root, 1);
});

export type AimProposal = z.infer<typeof AimProposalSchema>;

export type FlatProposedAim = Omit<ProposedAim, 'children'>;

export type FlatProposedConnection = {
  parentProposalId: string;
  childProposalId: string;
  weight: number;
  explanation?: string;
};

export function flattenAimProposal(root: ProposedAim): {
  aims: FlatProposedAim[];
  connections: FlatProposedConnection[];
} {
  const aims: FlatProposedAim[] = [];
  const connections: FlatProposedConnection[] = [];

  const visit = (aim: ProposedAim) => {
    const { children, ...flatAim } = aim;
    aims.push(flatAim);
    for (const connection of children) {
      connections.push({
        parentProposalId: aim.proposalId,
        childProposalId: connection.child.proposalId,
        weight: connection.weight,
        ...(connection.explanation ? { explanation: connection.explanation } : {}),
      });
      visit(connection.child);
    }
  };

  visit(root);
  return { aims, connections };
}
