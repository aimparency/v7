import * as fs from 'fs-extra';
import * as path from 'path';

export interface Reflection {
  timestamp: number;
  text: string;
  aimId?: string;
}

function getReflectionsPath(projectPath: string): string {
  const normalizedPath = projectPath.endsWith('.bowman')
    ? projectPath
    : path.join(projectPath, '.bowman');
  return path.join(normalizedPath, 'reflections.json');
}

/**
 * Add a reflection
 */
export async function addReflection(
  projectPath: string,
  text: string,
  aimId?: string
): Promise<Reflection> {
  const filePath = getReflectionsPath(projectPath);
  await fs.ensureDir(path.dirname(filePath));

  let reflections: Reflection[] = [];
  try {
    reflections = await fs.readJson(filePath);
  } catch {
    // File doesn't exist yet
  }

  const reflection: Reflection = {
    timestamp: Date.now(),
    text,
    aimId
  };

  reflections.push(reflection);

  // Keep last 100 reflections
  if (reflections.length > 100) {
    reflections = reflections.slice(-100);
  }

  await fs.writeJson(filePath, reflections, { spaces: 2 });
  return reflection;
}

/**
 * Get recent reflections
 */
export async function getReflections(
  projectPath: string,
  limit: number = 20
): Promise<Reflection[]> {
  const filePath = getReflectionsPath(projectPath);

  try {
    const reflections: Reflection[] = await fs.readJson(filePath);
    return reflections.slice(-limit).reverse();
  } catch {
    return [];
  }
}

/**
 * Format reflections for context
 */
export function formatReflections(reflections: Reflection[]): string {
  if (reflections.length === 0) return '';

  return reflections
    .slice(0, 5)
    .map(r => {
      const date = new Date(r.timestamp).toISOString().slice(0, 10);
      return `- ${date}: ${r.text.slice(0, 200)}`;
    })
    .join('\n');
}
