// Evaluates the harness decompose stage on this graph's history (see
// src/decomposition-eval.ts). Read-only on the graph; costs one planner call
// per sampled parent. Needs the backend running and a key for the planner role.
//
//   npx tsx scripts/eval-decomposition.ts [--project <repo>] [--samples 8] [--model <id>] [--resume <proposals.jsonl>]
// Proposals are appended per parent to runtime/evals/*.proposals.jsonl; --resume
// skips parents already in that file, so a slow or interrupted run loses nothing.
// --model overrides the first loop's model (same provider) without touching loops.json.
import fs from 'fs-extra';
import path from 'path';
import { calculateIdeaValues, missionPathsToRoot, toBowmanPath } from 'shared';
import { loadHarnessConfig } from 'shared/harness-config';
import { connectGraph, embedDocuments, readLoopRuntimeState } from 'agent-tools';
import { compileContext } from '../src/context.js';
import {
  compareChildren,
  coverage,
  embeddingText,
  maskChildren,
  realChildren,
  selectEvalParents
} from '../src/decomposition-eval.js';
import { createRoleModels } from '../src/models.js';
import { runStage } from '../src/stage-runner.js';
import { decomposeInstructions, decompositionSchema, stageSystemBase } from '../src/stages.js';

const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
};

const projectPath = toBowmanPath(path.resolve(argument('project', path.resolve(import.meta.dirname, '../../..'))));
const samples = Number(argument('samples', '8'));
const instanceId = 'eval-decomposition';
const THRESHOLDS = [0.8, 0.85, 0.9];

const graph = connectGraph(projectPath);
try {
  const { config, version } = loadHarnessConfig(projectPath);
  const configuredLoop = (await readLoopRuntimeState(projectPath)).loops[0];
  if (!configuredLoop) throw new Error('No loop in .bowman/runtime/loops.json: the planner model comes from the first loop.');
  const modelOverride = argument('model', '');
  const loop = modelOverride ? { ...configuredLoop, model: modelOverride, roles: {} } : configuredLoop;
  const secrets = await fs.readJson(path.join(projectPath, 'secrets.json')).catch(() => ({}));
  const planner = createRoleModels(loop, secrets).planner;

  const ideas = await graph.listIdeas();
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const { flowValues } = calculateIdeaValues(ideas);
  const parents = selectEvalParents(ideas, samples);
  console.log(`Planner ${planner.spec.provider} / ${planner.spec.model}, harness config ${version}, ${parents.length} parents.`);

  const outDir = path.join(projectPath, 'runtime', 'evals');
  await fs.ensureDir(outDir);
  const resumeFile = argument('resume', '');
  const proposalsFile = resumeFile || path.join(outDir, `decomposition-${new Date().toISOString().replace(/[:.]/g, '-')}.proposals.jsonl`);
  type Saved = { parentId: string; proposed: { text: string; description: string }[]; usage: { inputTokens: number; outputTokens: number } };
  const saved = new Map<string, Saved>(
    (await fs.readFile(proposalsFile, 'utf8').catch(() => '')).split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as Saved).map((entry) => [entry.parentId, entry])
  );

  const results = [];
  for (const parent of parents) {
    const real = realChildren(parent, ideaById);
    const done = saved.get(parent.id);
    if (done) {
      results.push({ parent, real, proposed: done.proposed, usage: done.usage });
      continue;
    }
    const { masked, hiddenIds } = maskChildren(ideaById, parent);
    const maskedParent = masked.get(parent.id)!;
    const similar = (await graph.searchIdeas(`${parent.text} ${parent.description ?? ''}`, 16))
      .filter((candidate) => candidate.id !== parent.id && !hiddenIds.has(candidate.id))
      .slice(0, 12);
    const { pathToRoot } = missionPathsToRoot(masked, maskedParent, flowValues);
    const prompt = compileContext({
      idea: maskedParent,
      ideaById: masked,
      missionPath: pathToRoot.map((step) => step.id),
      similarIds: similar.map((candidate) => candidate.id),
      recentEvents: [],
      humanMessages: [],
      facts: {}
    }, 'decompose', config.contextBudgetChars).text;

    // No tools: graph tools would reveal the hidden children.
    const run = await runStage({
      stage: 'decompose (eval)',
      model: planner.model,
      modelSpec: planner.spec,
      system: `${stageSystemBase(loop.systemPrompt)}\n\n${decomposeInstructions(config.decomposition.maxChildren)}`,
      prompt,
      tools: {},
      submit: { name: 'submit_decomposition', description: 'Submit the children for this idea.', schema: decompositionSchema },
      maxSteps: 2,
      projectPath,
      instanceId,
      signal: new AbortController().signal
    });
    const proposed = run.result?.children ?? [];
    results.push({ parent, real, proposed, usage: run.usage });
    await fs.appendFile(proposalsFile, `${JSON.stringify({ parentId: parent.id, proposed, usage: run.usage })}\n`);
    console.log(`- ${parent.id.slice(0, 8)} ${parent.text.slice(0, 70)}: ${real.length} real, ${proposed.length} proposed`);
  }

  const realVectors = await Promise.all(results.map((result) => embedDocuments(result.real.map(embeddingText))));
  const proposedVectors = await Promise.all(results.map((result) => embedDocuments(result.proposed.map(embeddingText))));
  const scored = results.map((result, index) => {
    const own = compareChildren(realVectors[index]!, proposedVectors[index]!);
    // Control: the same proposals scored against the next parent's real children.
    const control = compareChildren(realVectors[(index + 1) % results.length]!, proposedVectors[index]!);
    return {
      parentId: result.parent.id,
      parentText: result.parent.text,
      realChildren: result.real.map((child) => child.text),
      proposedChildren: result.proposed.map((child) => child.text),
      meanBest: own.meanBest,
      controlMeanBest: control.meanBest,
      coverage: Object.fromEntries(THRESHOLDS.map((threshold) => [threshold, coverage(own.bestPerReal, threshold)])),
      controlCoverage: Object.fromEntries(THRESHOLDS.map((threshold) => [threshold, coverage(control.bestPerReal, threshold)])),
      usage: result.usage
    };
  });
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const summary = {
    parents: scored.length,
    meanBest: mean(scored.map((entry) => entry.meanBest)),
    controlMeanBest: mean(scored.map((entry) => entry.controlMeanBest)),
    coverage: Object.fromEntries(THRESHOLDS.map((threshold) => [threshold, mean(scored.map((entry) => entry.coverage[threshold]!))])),
    controlCoverage: Object.fromEntries(THRESHOLDS.map((threshold) => [threshold, mean(scored.map((entry) => entry.controlCoverage[threshold]!))])),
    noSubmission: results.filter((result) => result.proposed.length === 0).length
  };

  const outFile = proposalsFile.replace(/\.proposals\.jsonl$/, '.json');
  await fs.writeJson(outFile, { planner: planner.spec, harnessConfigVersion: version, summary, scored }, { spaces: 2 });
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Written: ${outFile}`);
} finally {
  graph.close();
}
