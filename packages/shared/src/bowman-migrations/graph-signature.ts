// Layout-independent fingerprint of a .bowman graph, read straight from the
// files with explicit knowledge of every layout (not through the migrations),
// so "same signature before and after" is real evidence that a migration kept
// ideas, connections, phase commitments and statuses intact.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface GraphSignature {
  active: string[];
  archived: string[];
  /** parent>child weight explanation relativePosition */
  connections: string[];
  /** child<parent */
  parentLinks: string[];
  /** phase:idea, from phase.commitments */
  commitments: string[];
  /** phase:idea, from idea.committedIn */
  committedIn: string[];
  /** idea=state, legacy "done" read as "implemented" */
  states: string[];
  texts: string[];
  phases: string[];
}

const IDEA_DIRS = { active: ['ideas', 'aims'], archived: ['archived-ideas', 'archived-aims'] };

export async function readGraphSignature(bowmanPath: string): Promise<GraphSignature> {
  const signature: GraphSignature = {
    active: [], archived: [], connections: [], parentLinks: [], commitments: [], committedIn: [], states: [], texts: [], phases: []
  };
  for (const [kind, dirs] of Object.entries(IDEA_DIRS) as Array<['active' | 'archived', string[]]>) {
    for (const dir of dirs) {
      for (const record of await readJsonDir(path.join(bowmanPath, dir))) {
        signature[kind].push(record.id);
        signature.texts.push(`${record.id}=${record.text}`);
        signature.states.push(`${record.id}=${record.status?.state === 'done' ? 'implemented' : record.status?.state}`);
        for (const connection of record.supportingConnections ?? []) {
          const child = connection.ideaId ?? connection.aimId;
          signature.connections.push(`${record.id}>${child} ${connection.weight} ${connection.explanation ?? ''} ${JSON.stringify(connection.relativePosition)}`);
        }
        for (const parent of record.supportedIdeas ?? record.supportedAims ?? []) signature.parentLinks.push(`${record.id}<${parent}`);
        for (const phase of record.committedIn ?? []) signature.committedIn.push(`${phase}:${record.id}`);
      }
    }
  }
  for (const phase of await readJsonDir(path.join(bowmanPath, 'phases'))) {
    signature.phases.push(`${phase.id}=${phase.name}`);
    for (const id of phase.commitments ?? []) signature.commitments.push(`${phase.id}:${id}`);
  }
  for (const list of Object.values(signature)) list.sort();
  return signature;
}

/** Names of the signature parts that differ; empty when both graphs match. */
export function diffGraphSignatures(before: GraphSignature, after: GraphSignature): string[] {
  return (Object.keys(before) as Array<keyof GraphSignature>)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

async function readJsonDir(dir: string): Promise<any[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const records = await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
    try {
      return JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    } catch {
      return null;
    }
  }));
  return records.filter(Boolean);
}
