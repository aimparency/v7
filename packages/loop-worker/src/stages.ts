import { z } from 'zod';
import { isOngoingState, type Idea } from 'shared';

// The harness cycle as an explicit stage machine. Each model stage ends with a
// zod-validated result; the harness, not the model, turns results into graph
// writes. Everything here is pure so the transitions are testable without a model.

export type Stage = 'orient' | 'decompose' | 'execute' | 'verify' | 'reflect' | 'record';

/** Hard ceiling; harness.json decomposition.maxChildren can only lower it. */
const MAX_CHILDREN = 7;

export const decompositionSchema = z.object({
  children: z.array(z.object({
    existingIdeaId: z.string().optional()
      .describe('Id of an existing idea from the shown similar ideas that already is this child: link it instead of creating a duplicate'),
    text: z.string().describe('The child idea, one line'),
    description: z.string().describe('What to do and the evidence that will show it is done'),
    hypothesis: z.string().describe('A claim that could fail: the effect this child should have on the parent'),
    weight: z.number().positive().describe('Relative contribution to the parent, 1 = normal'),
    cost: z.number().positive().describe('Estimated direct cost in the project cost unit')
  })).max(MAX_CHILDREN),
  rationale: z.string().describe('Why these children cover the parent, or why no decomposition is needed')
});

export const executionSchema = z.object({
  outcome: z.enum(['done', 'too_large', 'blocked', 'no_progress'])
    .describe('done: acceptance evidence produced. too_large: needs decomposition first. blocked: needs a human decision or action. no_progress: tried, nothing to show'),
  summary: z.string().describe('What was changed or found'),
  evidence: z.string().describe('The acceptance evidence: test output, observed result, file and line'),
  commands: z.array(z.string()).describe('Verification commands that were run, so a verifier can re-run them')
});

export const verificationSchema = z.object({
  verdict: z.enum(['verified', 'failed', 'unverifiable']),
  reasons: z.string().describe('Why: what was checked, what passed, what is missing')
});

export const reflectionSchema = z.object({
  reflections: z.array(z.object({
    parentId: z.string(),
    held: z.enum(['held', 'did_not_hold', 'unclear']),
    reflection: z.string().describe('How the child actually contributed to the parent, one or two sentences')
  }))
});

export type Decomposition = z.infer<typeof decompositionSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type Reflection = z.infer<typeof reflectionSchema>;

/** Same rule as work selection: open and without ongoing children. */
export function isOpenLeaf(idea: Idea, ideaById: Map<string, Idea>): boolean {
  return idea.status.state === 'open' && !(idea.supportingConnections ?? []).some((connection) =>
    isOngoingState(ideaById.get(connection.ideaId)?.status.state ?? 'implemented')
  );
}

/** Leaves are executed, containers are decomposed. */
export function workStageFor(idea: Idea, ideaById: Map<string, Idea>): 'decompose' | 'execute' {
  return isOpenLeaf(idea, ideaById) ? 'execute' : 'decompose';
}

export type StageOutcome =
  | { stage: 'orient'; work: 'decompose' | 'execute' }
  | { stage: 'decompose'; result: Decomposition | null }
  | { stage: 'execute'; result: Execution | null }
  | { stage: 'verify'; result: Verification | null }
  | { stage: 'reflect' };

/** The transition table. A null result means the model never submitted one. */
export function nextStage(outcome: StageOutcome, decomposedThisCycle: boolean): Stage {
  switch (outcome.stage) {
    case 'orient':
      return outcome.work;
    case 'decompose':
      return 'record';
    case 'execute':
      if (outcome.result?.outcome === 'done') return 'verify';
      // A leaf the executor finds too large is decomposed in the same cycle, once.
      if (outcome.result?.outcome === 'too_large' && !decomposedThisCycle) return 'decompose';
      return 'record';
    case 'verify':
      return outcome.result?.verdict === 'verified' ? 'reflect' : 'record';
    case 'reflect':
      return 'record';
  }
}

export type StatusChange = { state: string; comment: string };

/** The idea's new status after its execution and verification, or null to leave it as is. */
export function statusAfter(execution: Execution | null, verification: Verification | null): StatusChange | null {
  if (verification) {
    if (verification.verdict === 'verified') {
      return { state: 'implemented', comment: `${execution?.evidence ?? ''}\n\nVerified by a separate verifier stage: ${verification.reasons}`.trim() };
    }
    if (verification.verdict === 'failed') {
      return { state: 'open', comment: `Harness attempt not accepted. Verifier objection: ${verification.reasons}\nExecutor claimed: ${execution?.summary ?? ''}` };
    }
    return { state: 'review', comment: `Verifier could not decide: ${verification.reasons}\nExecutor evidence: ${execution?.evidence ?? ''}` };
  }
  if (execution?.outcome === 'blocked') {
    return { state: 'human-dependent', comment: execution.summary };
  }
  return null;
}

/** A reflection as stored on the parent edge: verdict word first, then the reason. */
export function formatReflection(entry: Reflection['reflections'][number]): string {
  const verdict = { held: 'Held', did_not_hold: 'Did not hold', unclear: 'Unclear' }[entry.held];
  return `${verdict}: ${entry.reflection}`;
}

/** A claimed command the harness re-ran itself before verification. */
export type Receipt = { command: string; exitCode: number; refused?: string; outputTail: string };

export function formatReceipts(receipts: Receipt[]): string {
  if (receipts.length === 0) return '(the executor claimed no commands)';
  return receipts.map((receipt) => receipt.refused
    ? `$ ${receipt.command}\n  not run: ${receipt.refused}`
    : `$ ${receipt.command}\n  exit ${receipt.exitCode}\n${receipt.outputTail.replace(/^/gm, '  | ')}`
  ).join('\n\n');
}

/** Code overrules the verifier: a claimed command that fails when re-run cannot be verified work. */
export function applyReceipts(verification: Verification, receipts: Receipt[]): Verification {
  const failing = receipts.filter((receipt) => !receipt.refused && receipt.exitCode !== 0);
  if (verification.verdict !== 'verified' || failing.length === 0) return verification;
  const commands = failing.map((receipt) => `\`${receipt.command}\` exited ${receipt.exitCode}`).join(', ');
  return { verdict: 'failed', reasons: `${verification.reasons}\nOverruled by the harness: re-run of the claimed command ${commands}.` };
}
