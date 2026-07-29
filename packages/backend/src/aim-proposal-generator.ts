import path from 'node:path';
import fs from 'fs-extra';
import { z } from 'zod';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject } from 'ai';
import { AimProposalSchema, type AimProposal } from 'shared';

const generateObjectUntyped = generateObject as unknown as (options: Record<string, unknown>) =>
  Promise<{ object: unknown }>;

type GeneratedAim = {
  text: string;
  description?: string;
  children: Array<{
    child: GeneratedAim;
    weight: number;
    explanation?: string;
  }>;
  intrinsicValue?: number;
  cost?: number;
  status?: 'open' | 'unclear' | 'human-dependent';
  statusComment?: string;
  tags?: string[];
};

const GeneratedAimSchema: z.ZodType<GeneratedAim> = z.lazy(() => z.object({
  text: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5_000).optional(),
  children: z.array(z.object({
    child: GeneratedAimSchema,
    weight: z.number().finite().positive(),
    explanation: z.string().trim().max(1_000).optional()
  })).max(10),
  intrinsicValue: z.number().finite().nonnegative().optional(),
  cost: z.number().finite().positive().optional(),
  status: z.enum(['open', 'unclear', 'human-dependent']).optional(),
  statusComment: z.string().trim().max(1_000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(10).optional()
}));

const GeneratedProposalSchema = z.object({
  root: GeneratedAimSchema,
  assumptions: z.array(z.string().trim().min(1).max(1_000)).max(10).default([]),
  questions: z.array(z.string().trim().min(1).max(1_000)).max(10).default([])
});

type GeneratedProposal = z.infer<typeof GeneratedProposalSchema>;

type ProposalModelConfig = {
  provider: 'nvidia' | 'openrouter' | 'openai-compatible';
  model: string;
  baseUrl: string;
  apiKey: string;
};

const providerKey = {
  nvidia: 'NVIDIA_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'openai-compatible': 'LOOP_API_KEY'
} as const;

async function readProposalModelConfig(projectPath: string): Promise<ProposalModelConfig> {
  const runtime = await fs.readJson(path.join(projectPath, 'runtime', 'loops.json')).catch(() => null) as any;
  const selected = runtime?.loops?.find((loop: any) => loop.id === runtime.selectedLoopId) ?? runtime?.loops?.[0];
  const fallback = await fs.readJson(path.join(projectPath, 'runtime', 'loop-config.json')).catch(() => null) as any;
  const config = selected ?? fallback;
  if (!config?.model || !config?.baseUrl) {
    throw new Error('Configure a loop model before generating aim proposals');
  }
  const provider = z.enum(['nvidia', 'openrouter', 'openai-compatible']).parse(config.provider ?? 'nvidia');
  const secrets = await fs.readJson(path.join(projectPath, 'secrets.json')).catch(() => ({})) as Record<string, string>;
  const apiKey = secrets[providerKey[provider]]?.trim();
  if (!apiKey) {
    throw new Error(`Add ${providerKey[provider]} in Loop settings before generating aim proposals`);
  }
  return { provider, model: config.model, baseUrl: config.baseUrl, apiKey };
}

export function buildAimProposalFromGenerated(input: {
  transcript: string;
  existingParentIds: string[];
  phaseId?: string;
  generated: GeneratedProposal;
  revision?: string;
}): AimProposal {
  let nextId = 0;
  const addDraftIds = (aim: GeneratedAim): AimProposal['root'] => {
    nextId += 1;
    return {
      ...aim,
      proposalId: `draft-${nextId}`,
      children: aim.children.map(connection => ({
        ...connection,
        child: addDraftIds(connection.child)
      }))
    };
  };

  return AimProposalSchema.parse({
    revision: input.revision ?? `model-${Date.now()}-${crypto.randomUUID()}`,
    sourceText: input.transcript,
    root: addDraftIds(input.generated.root),
    existingParentIds: input.existingParentIds,
    ...(input.phaseId ? { phaseId: input.phaseId } : {}),
    assumptions: input.generated.assumptions,
    questions: input.generated.questions
  });
}

export async function generateAimProposal(input: {
  projectPath: string;
  transcript: string;
  existingParentIds: string[];
  phaseId?: string;
  parentContext: Array<{ text: string; description?: string }>;
}): Promise<AimProposal> {
  const config = await readProposalModelConfig(input.projectPath);
  const provider = createOpenAICompatible({
    name: `aim-proposal-${config.provider}`,
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    supportsStructuredOutputs: true
  });
  const context = input.parentContext.length
    ? `\nSelected parent context:\n${input.parentContext.map(parent =>
      `- ${parent.text}${parent.description ? `: ${parent.description}` : ''}`
    ).join('\n')}`
    : '';
  // Keep the recursive schema as the runtime authority without asking the AI
  // SDK's generic types to expand it recursively (which exceeds TS depth).
  const result = await generateObjectUntyped({
    model: provider(config.model),
    schema: GeneratedProposalSchema as z.ZodType<any>,
    schemaName: 'AimProposalDraft',
    system: [
      'Decompose the human goal into a small contribution tree.',
      'Each child must concretely contribute to its parent; weights express relative contribution.',
      'Return assumptions and genuinely unresolved questions explicitly.',
      'Do not invent IDs, phases, existing graph objects, execution claims, or completed work.',
      'Prefer 1–7 aims and depth at most 3. Keep titles concise.'
    ].join(' '),
    prompt: `Human goal:\n${input.transcript}${context}`
  });

  return buildAimProposalFromGenerated({
    transcript: input.transcript,
    existingParentIds: input.existingParentIds,
    phaseId: input.phaseId,
    generated: GeneratedProposalSchema.parse(result.object)
  });
}
