import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { normalizeBowmanPath, writeJsonAtomic } from './loop-state.js';

const experimentEvidenceSchema = z.object({
  summary: z.string().min(1),
  ref: z.string().optional(),
  observedAt: z.number()
});

const beliefUpdateSchema = z.object({
  previousConfidence: z.number().min(0).max(1).optional(),
  newConfidence: z.number().min(0).max(1),
  reason: z.string().min(1)
});

export const experimentSchema = z.object({
  id: z.string(),
  aimIds: z.array(z.string()).default([]),
  hypothesis: z.string().min(1),
  prediction: z.string().min(1),
  expectedCost: z.string().min(1),
  expectedUpside: z.string().min(1),
  successMetric: z.string().min(1),
  stopCondition: z.string().min(1),
  status: z.enum(['draft', 'running', 'waiting', 'succeeded', 'failed', 'inconclusive', 'stopped']).default('draft'),
  evidence: z.array(experimentEvidenceSchema).default([]),
  result: z.string().optional(),
  beliefUpdate: beliefUpdateSchema.optional(),
  economicOutcomeRef: z.string().optional(),
  nextDecision: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});

const experimentStateSchema = z.object({
  version: z.literal(1).default(1),
  experiments: z.array(experimentSchema).default([])
});

export type Experiment = z.infer<typeof experimentSchema>;
export type ExperimentEvidence = z.infer<typeof experimentEvidenceSchema>;
export type BeliefUpdate = z.infer<typeof beliefUpdateSchema>;

export type CreateExperimentInput = Pick<
  Experiment,
  'hypothesis' | 'prediction' | 'expectedCost' | 'expectedUpside' | 'successMetric' | 'stopCondition'
> & {
  aimIds?: string[];
  status?: Experiment['status'];
};

export type UpdateExperimentInput = Partial<Pick<
  Experiment,
  'status' | 'result' | 'beliefUpdate' | 'economicOutcomeRef' | 'nextDecision'
>> & {
  evidence?: ExperimentEvidence;
};

function getExperimentStatePath(projectPath: string): string {
  return path.join(normalizeBowmanPath(projectPath), 'runtime', 'experiments.json');
}

export async function listExperiments(projectPath: string): Promise<Experiment[]> {
  const statePath = getExperimentStatePath(projectPath);
  if (!(await fs.pathExists(statePath))) return [];
  return experimentStateSchema.parse(await fs.readJson(statePath)).experiments;
}

async function saveExperiments(projectPath: string, experiments: Experiment[]): Promise<void> {
  await writeJsonAtomic(getExperimentStatePath(projectPath), experimentStateSchema.parse({
    version: 1,
    experiments
  }));
}

export async function createExperiment(projectPath: string, input: CreateExperimentInput): Promise<Experiment> {
  const now = Date.now();
  const experiment = experimentSchema.parse({
    id: uuidv4(),
    ...input,
    createdAt: now,
    updatedAt: now
  });
  const experiments = await listExperiments(projectPath);
  experiments.push(experiment);
  await saveExperiments(projectPath, experiments);
  return experiment;
}

export async function updateExperiment(
  projectPath: string,
  experimentId: string,
  input: UpdateExperimentInput
): Promise<Experiment> {
  const experiments = await listExperiments(projectPath);
  const index = experiments.findIndex((experiment) => experiment.id === experimentId);
  if (index < 0) throw new Error(`Experiment not found: ${experimentId}`);
  const current = experiments[index]!;
  const next = experimentSchema.parse({
    ...current,
    ...input,
    evidence: input.evidence ? [...current.evidence, input.evidence] : current.evidence,
    updatedAt: Date.now()
  });
  experiments[index] = next;
  await saveExperiments(projectPath, experiments);
  return next;
}
