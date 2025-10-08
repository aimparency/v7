import { z } from 'zod';

export const AimStatusSchema = z.object({
  state: z.enum(['open', 'done', 'cancelled', 'partially', 'failed']),
  comment: z.string(),
  date: z.number() // Date.now() timestamp
});

export const AimSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  incoming: z.array(z.string().uuid()),
  outgoing: z.array(z.string().uuid()),
  committedIn: z.array(z.string().uuid()),
  status: AimStatusSchema
});

export const PhaseSchema = z.object({
  id: z.string().uuid(),
  from: z.number(), // Date.now() timestamp
  to: z.number(), // Date.now() timestamp
  parent: z.string().uuid().nullable(),
  commitments: z.array(z.string().uuid()),
  name: z.string()
});

export const ProjectMetaSchema = z.object({
  name: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/) // hex color
});


export type Aim = z.infer<typeof AimSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type AimStatus = z.infer<typeof AimStatusSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;