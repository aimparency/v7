import fs from 'fs-extra';
import path from 'node:path';

// Which other spaces of this machine might support which open ideas here.
// Another space is read only through what it says about itself to others:
// its subtitle and its (up to) three ideas of highest intrinsic value, never
// the rest of its ideas (the black box of e81b11c3). Matching is by meaning
// (normalized embeddings, so cosine = dot product); linking stays a decision.

export type SelfDescription = { path: string, name: string, repoId: string, lines: string[] };
export type Suggestion = { ideaId: string, ideaText: string, space: Omit<SelfDescription, 'lines'>, line: string, score: number };

/** A space's self-description, or null when it says nothing (no subtitle, no valued idea) or has no id to link by. */
export async function readSelfDescription(bowmanPath: string): Promise<SelfDescription | null> {
  const meta = await fs.readJson(path.join(bowmanPath, 'meta.json')).catch(() => null) as { name?: string, subtitle?: string, repoId?: string } | null;
  if (!meta?.repoId) return null;
  const files = (await fs.readdir(path.join(bowmanPath, 'ideas')).catch(() => [] as string[])).filter(file => file.endsWith('.json'));
  const valued: { text: string, value: number }[] = [];
  for (const file of files) {
    const idea = await fs.readJson(path.join(bowmanPath, 'ideas', file)).catch(() => null) as { text?: string, intrinsicValue?: number } | null;
    if (idea?.text && (idea.intrinsicValue ?? 0) > 0) valued.push({ text: idea.text, value: idea.intrinsicValue! });
  }
  const top = valued.sort((left, right) => right.value - left.value).slice(0, 3).map(idea => idea.text);
  const lines = [...(meta.subtitle?.trim() ? [meta.subtitle.trim()] : []), ...top];
  if (lines.length === 0) return null;
  return { path: path.dirname(bowmanPath), name: meta.name ?? path.basename(path.dirname(bowmanPath)), repoId: meta.repoId, lines };
}

const dot = (left: number[], right: number[]) => left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);

/** Best-matching pairs, at most `perIdea` spaces per idea, above `minScore`, best first. */
export function rankSuggestions(
  ideas: { id: string, text: string, vector: number[] }[],
  spaces: { space: Omit<SelfDescription, 'lines'>, lines: { text: string, vector: number[] }[] }[],
  { limit = 20, perIdea = 3, minScore = 0.65 } = {}
): Suggestion[] {
  const pairs: Suggestion[] = [];
  for (const idea of ideas) {
    const forIdea = spaces.flatMap(({ space, lines }) => {
      const best = lines.map(line => ({ line: line.text, score: dot(idea.vector, line.vector) })).sort((a, b) => b.score - a.score)[0];
      return best && best.score >= minScore ? [{ ideaId: idea.id, ideaText: idea.text, space, line: best.line, score: Math.round(best.score * 1000) / 1000 }] : [];
    });
    pairs.push(...forIdea.sort((a, b) => b.score - a.score).slice(0, perIdea));
  }
  return pairs.sort((a, b) => b.score - a.score).slice(0, limit);
}
