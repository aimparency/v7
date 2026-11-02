// Spec-driven planning tools (GitHub spec-kit, spec-workflow-mcp) keep an agent's
// work as markdown checklists in <spec folder>/tasks.md. This turns them into ideas.
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SpecTask {
  /** Stable key within its file: the task id (T001, 2.1) or else the title. */
  key: string;
  title: string;
  state: 'open' | 'partially' | 'implemented';
  details: string;
}

const TASK_LINE = /^- \[([ xX-])\]\s+(.+)$/;
const TASK_ID = /^(T\d+|\d+(?:\.\d+)*)\.?\s+(.+)$/;
const STATES = { ' ': 'open', '-': 'partially', x: 'implemented', X: 'implemented' } as const;

/** Top-level checklist items; indented lines below an item become its details. */
export function parseSpecTasks(markdown: string): SpecTask[] {
  const tasks: SpecTask[] = [];
  let current: SpecTask | null = null;
  for (const line of markdown.split('\n')) {
    const task = line.match(TASK_LINE);
    if (task) {
      const label = task[2]!.trim();
      const id = label.match(TASK_ID);
      current = { key: id ? id[1]! : label, title: label, state: STATES[task[1] as keyof typeof STATES], details: '' };
      tasks.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.details += `${current.details ? '\n' : ''}${line.trim()}`;
    } else if (line.trim()) {
      current = null;
    }
  }
  return tasks;
}

/** tasks.md files at or below target (a tasks.md file or a directory), skipping node_modules and .git. */
export async function findSpecTaskFiles(target: string): Promise<string[]> {
  const stat = await fs.stat(target);
  if (stat.isFile()) return [target];
  const found: string[] = [];
  for (const entry of await fs.readdir(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) found.push(...await findSpecTaskFiles(full));
    else if (entry.name === 'tasks.md') found.push(full);
  }
  return found.sort();
}

/** The marker a task's description carries, so a re-import skips it. */
export const specTaskMarker = (relativeFile: string, key: string) => `Spec task ${relativeFile}#${key}`;
