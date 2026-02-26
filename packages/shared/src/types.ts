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

export const AimSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  description: z.string().optional(),
  reflection: z.string().optional(), // Notes on how this aim went
  archived: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  supportingConnections: z.array(ConnectionSchema).default([]),
  incoming: z.array(z.string().uuid()).optional(), // Deprecated: use supportingConnections
  supportedAims: z.array(z.string().uuid()),
  committedIn: z.array(z.string().uuid()),
  status: AimStatusSchema,
  intrinsicValue: z.number().default(0),
  cost: z.number().default(1),
  loopWeight: z.number().default(0),
  calculatedValue: z.number().optional(),
  calculatedCost: z.number().optional(),
  calculatedDoneCost: z.number().optional(),
  calculatedPriority: z.number().optional()
});

export const PhaseSchema = z.object({
  id: z.string().uuid(),
  from: z.number(), // Date.now() timestamp
  to: z.number(), // Date.now() timestamp
  parent: z.string().uuid().nullable(),
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
  statuses: z.array(AimStateSchema).optional()
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
