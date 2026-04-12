import { z } from 'zod';

export const AimStatusSchema = z.object({
  state: z.string(),
  comment: z.string(),
  date: z.number() // Date.now() timestamp
});

export type AimStatusState = string;

export const ConnectionSchema = z.object({
  aimId: z.string().uuid(),
  relativePosition: z.tuple([z.number(), z.number()]).default([0, 0]),
  weight: z.number().default(1),
  explanation: z.string().optional(),
  reflection: z.string().optional() // How did this connection work out?
});

export type Connection = z.infer<typeof ConnectionSchema>;

// Reflection pattern: Periodic self-evaluation
export const ReflectionSchema = z.object({
  date: z.number(), // Unix timestamp
  context: z.string(), // What were you trying to achieve?
  outcome: z.string(), // What actually happened?
  effectiveness: z.string(), // How well did your approach work?
  lesson: z.string(), // What would you do differently next time?
  pattern: z.string().optional() // Does this relate to past experiences?
});

export type Reflection = z.infer<typeof ReflectionSchema>;

export const AimSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  description: z.string().optional(),
  reflection: z.string().optional(), // Notes on how this aim went (simple text)
  reflections: z.array(ReflectionSchema).default([]), // Structured periodic self-evaluations
  archived: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  supportingConnections: z.array(ConnectionSchema).default([]),
  incoming: z.array(z.string().uuid()).optional(), // Deprecated: use supportingConnections
  supportedAims: z.array(z.string().uuid()),
  committedIn: z.array(z.string().uuid()),
  status: AimStatusSchema,
  intrinsicValue: z.number().default(0),
  cost: z.number().default(1), // Effort/resource cost (not time)
  loopWeight: z.number().default(0),
  // Economic refinement: temporal and uncertainty modeling
  duration: z.number().default(1), // Time horizon in days (when will returns arrive?)
  costVariance: z.number().default(0), // Uncertainty in cost estimate (std deviation)
  valueVariance: z.number().default(0), // Uncertainty in value estimate (std deviation)
  calculatedValue: z.number().optional(),
  calculatedCost: z.number().optional(),
  calculatedDoneCost: z.number().optional(),
  calculatedPriority: z.number().optional()
});

export const PhaseSchema = z.object({
  id: z.string().uuid(),
  from: z.number(), // Date.now() timestamp
  to: z.number(), // Date.now() timestamp
  order: z.number().int().nonnegative().optional(),
  parent: z.string().uuid().nullable(),
  childPhaseIds: z.array(z.string().uuid()).optional(),
  commitments: z.array(z.string().uuid()),
  name: z.string()
});

export const AimStateSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ongoing: z.boolean()
});

export const ProjectMetaSchema = z.object({
  name: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), // hex color
  statuses: z.array(AimStateSchema).optional(),
  phaseCursors: z.record(z.string(), z.number().int()).optional(),
  phaseActiveLevel: z.number().int().min(0).optional(),
  rootPhaseIds: z.array(z.string().uuid()).optional()
});

export const SystemStatusSchema = z.object({
  computeCredits: z.number(),
  funds: z.number()
});

export interface Hint {
  key: string;
  action: string;
}

export type Aim = z.infer<typeof AimSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type AimStatus = z.infer<typeof AimStatusSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type SystemStatus = z.infer<typeof SystemStatusSchema>;
export type SearchAimResult = Aim & { score?: number };
