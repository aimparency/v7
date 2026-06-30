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

// A repo-level cross-repo link: a local aim is supported by ANOTHER repo AS A
// WHOLE (black box), identified by repoId — NO aimId, because repo-only links
// never target a specific external aim (see the inter-repository-links design).
// The other repo keeps no back-reference; value flows out into the repo node,
// which the value engine treats as a leaf sink. Kept in its own array
// (supportingRepos) rather than overloaded onto ConnectionSchema so aim edges
// keep their required aimId and the consistency checker skips repo edges for
// free (it only walks supportingConnections/supportedAims).
export const RepoConnectionSchema = z.object({
  repoId: z.string().uuid(),
  relativePosition: z.tuple([z.number(), z.number()]).default([0, 0]),
  weight: z.number().default(1),
  explanation: z.string().optional(),
  reflection: z.string().optional() // How did this cross-repo link work out?
});

export type RepoConnection = z.infer<typeof RepoConnectionSchema>;

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
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), // Custom node color (hex); null/absent clears it. Overrides status/priority color when set
  tags: z.array(z.string()).default([]),
  supportingConnections: z.array(ConnectionSchema).default([]),
  supportingRepos: z.array(RepoConnectionSchema).optional(), // repo-level cross-repo links (this aim is supported by a whole external repo)
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
  from: z.number().optional(), // legacy, kept for backward compat reading old files
  to: z.number().optional(),   // legacy, kept for backward compat reading old files
  order: z.number().int().nonnegative().optional(), // legacy
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

// Portable linked-repo entry — committed in meta.json so the link travels with
// the repo. Carries identity (repoId) and human/relocation hints (name, url),
// but NEVER a localPath: where the repo is checked out is machine-specific and
// lives in the runtime registry instead.
export const LinkedRepoSchema = z.object({
  repoId: z.string().uuid(), // stable identity of the linked repo
  name: z.string(),          // display name (snapshot of the target's name)
  url: z.string().optional() // optional relocation hint (e.g. git remote)
});

export type LinkedRepo = z.infer<typeof LinkedRepoSchema>;

// Machine-local resolution for one linked repo. Lives in .bowman/runtime/
// (gitignored) — committed absolute paths would break for every collaborator.
export const LinkedRepoLocalSchema = z.object({
  repoId: z.string().uuid(),
  localPath: z.string(),     // where this repo's .bowman is checked out HERE
  access: z.enum(['read', 'write']).default('read')
});

export type LinkedRepoLocal = z.infer<typeof LinkedRepoLocalSchema>;

// The machine-local registry file: repoId → localPath map (as a list).
export const LinkedRepoRegistrySchema = z.object({
  repos: z.array(LinkedRepoLocalSchema).default([])
});

export type LinkedRepoRegistry = z.infer<typeof LinkedRepoRegistrySchema>;

export const ProjectMetaSchema = z.object({
  name: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), // hex color
  repoId: z.string().uuid().optional(), // stable repo identity (generated+persisted on first read)
  linkedRepos: z.array(LinkedRepoSchema).optional(), // portable cross-repo links
  initialInstructions: z.string().optional(), // user-authored project instructions posted to the agent at the start of each conversation
  statuses: z.array(AimStateSchema).optional(),
  dataModelVersion: z.number().int().positive().optional(),
  phaseCursors: z.record(z.string(), z.string()).optional(), // column level (string) → selected phase ID
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
export type SearchAimResult = Aim & {
  score?: number;
  idMatch?: {
    prefix: string;
  };
};
