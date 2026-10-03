import fs from 'fs-extra';
import path from 'path';
import { PhaseSchema } from 'shared';
import type { Phase } from 'shared';
import { normalizeProjectPath } from '../project-path.js';

export function normalizePhase(rawPhase: unknown): Phase {
  const parsed = PhaseSchema.partial().parse(rawPhase);

  if (
    !parsed.id ||
    parsed.parent === undefined ||
    !parsed.commitments ||
    !parsed.name
  ) {
    throw new Error('Invalid phase data');
  }

  return {
    id: parsed.id,
    from: parsed.from,
    to: parsed.to,
    order: parsed.order,
    parent: parsed.parent,
    childPhaseIds: parsed.childPhaseIds ?? [],
    commitments: parsed.commitments,
    name: parsed.name
  };
}

export function compareLegacyPhaseOrder(a: Phase, b: Phase): number {
  const fields: Array<keyof Pick<Phase, 'order' | 'from' | 'to'>> = ['order', 'from', 'to'];
  for (const field of fields) {
    const aValue = a[field];
    const bValue = b[field];
    if (aValue !== undefined || bValue !== undefined) {
      const difference = (aValue ?? Number.POSITIVE_INFINITY) - (bValue ?? Number.POSITIVE_INFINITY);
      if (difference !== 0) return difference;
    }
  }
  return a.id.localeCompare(b.id);
}

export async function deriveLegacySiblingIds(
  rawProjectPath: string,
  parentPhaseId: string | null
): Promise<string[]> {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const phasesDir = path.join(projectPath, 'phases');
  if (!await fs.pathExists(phasesDir)) return [];

  const siblings: Phase[] = [];
  for (const file of await fs.readdir(phasesDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const phase = normalizePhase(await fs.readJson(path.join(phasesDir, file)));
      if (phase.parent === parentPhaseId) siblings.push(phase);
    } catch {
      // Malformed phase files remain isolated from migration, as they are from listing.
    }
  }
  return siblings.sort(compareLegacyPhaseOrder).map((phase) => phase.id);
}
