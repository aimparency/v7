import path from 'path';
import {
  appendLoopEvent,
  drainInbox,
  gitDiff,
  gitStatus,
  runCommand,
  maybeFindAssociation,
  readLoopRuntimeState,
  type GraphTools,
  type LoopDefinition,
  type PrioritizedIdea
} from 'agent-tools';
import { calculateIdeaValues, missionPathsToRoot, type Idea } from 'shared';
import { loadHarnessConfig, type HarnessConfig } from 'shared/harness-config';
import { compileContext, type ContextInput } from './context.js';
import { filterToolsByCapabilities } from './capabilities.js';
import { applyDecomposition, applyReflections, applyStatus } from './graph-writes.js';
import { selectCycleTarget } from './runtime-policy.js';
import { runStage, type StageTrace, type StageUsage } from './stage-runner.js';
import { writeCycleTrace } from './traces.js';
import { runClaudeCodeExecutor } from './claude-code-executor.js';
import { cycleCostUsd, spentTodayUsd, tokensUsed, unpricedModels } from './costs.js';
import {
  decompositionSchema,
  executionSchema,
  applyReceipts,
  formatReceipts,
  decomposeInstructions,
  EXECUTE_INSTRUCTIONS,
  stageSystemBase,
  nextStage,
  reflectionSchema,
  statusAfter,
  verificationSchema,
  workStageFor,
  type Decomposition,
  type Execution,
  type Receipt,
  type Stage,
  type StageOutcome,
  type Verification
} from './stages.js';
import { buildWorkerTools } from './worker-tools.js';
import type { RoleModels } from './models.js';
import { errorMessage, markLoopPhase } from './worker-state.js';

/** Which of the worker tools each model stage gets. Graph writes are never among them: the harness applies results. */
const READ_GRAPH = ['get_idea_context', 'search_ideas_semantic'];
const READ_CODE = ['list_files', 'search_files', 'read_file', 'git_status', 'git_diff', 'code_intelligence'];
export const STAGE_TOOL_NAMES = {
  decompose: [...READ_GRAPH, ...READ_CODE],
  execute: [
    ...READ_GRAPH, ...READ_CODE,
    'run_command', 'propose_patch', 'apply_patch', 'str_replace', 'line_replace',
    'experiment', 'status_report', 'human_action_required', 'external_action_required'
  ],
  verify: [...READ_CODE, 'run_command'],
  reflect: [] as string[]
};


type CycleContext = {
  projectPath: string;
  instanceId: string;
  loop: LoopDefinition;
  graph: GraphTools;
  signal: AbortSignal;
  models: RoleModels;
};

export async function runCycle(ctx: CycleContext) {
  const { projectPath, instanceId, loop, graph, signal } = ctx;
  const executionPath = loop.worktreePath || projectPath;
  const allTools = filterToolsByCapabilities(
    buildWorkerTools({ projectPath, instanceId, executionPath, graph, signal }),
    loop.capabilities
  );
  const toolsFor = (stage: keyof typeof STAGE_TOOL_NAMES) =>
    Object.fromEntries(STAGE_TOOL_NAMES[stage].flatMap((name) => allTools[name] ? [[name, allTools[name]]] : []));

  // Read every cycle, so an edit to .bowman/harness.json applies from the next cycle on.
  const harnessConfig = loadHarnessConfig(projectPath);
  const { config } = harnessConfig;

  const { maxUsdPerDay, maxTokensPerCycle } = config.budgets;
  if (maxUsdPerDay !== undefined) {
    const spent = await spentTodayUsd(projectPath);
    if (spent >= maxUsdPerDay) {
      await appendLoopEvent(projectPath, instanceId, {
        role: 'system',
        kind: 'status',
        content: `Daily budget reached: $${spent.toFixed(4)} of $${maxUsdPerDay} spent today (UTC). Skipping this cycle.`
      });
      return;
    }
  }

  // orient
  await markLoopPhase(projectPath, instanceId, 'orient: picking an idea');
  const instance = (await readLoopRuntimeState(projectPath)).instances.find((candidate) => candidate.id === instanceId);
  const ideas = await graph.listIdeas();
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const prioritized = await graph.getPrioritizedIdeas(instance?.targetIdeaId ? Number.MAX_SAFE_INTEGER : 5, instance?.targetPhaseId);
  const target = selectCycleTarget(prioritized, instance?.targetIdeaId, ideaById);
  if (!target) throw new Error('No open prioritized idea found in the active phase.');
  const idea = target.idea;
  const work = workStageFor(idea, ideaById);
  await logStage(ctx, `orient → ${work}: ${idea.text}`);

  const gathered = await gatherContextInput(ctx, target, ideas, ideaById);
  const baseSystem = stageSystemBase(loop.systemPrompt);

  const usage: StageUsage = { inputTokens: 0, outputTokens: 0 };
  const addUsage = (stageUsage: StageUsage) => {
    usage.inputTokens += stageUsage.inputTokens;
    usage.outputTokens += stageUsage.outputTokens;
  };
  let decomposition: Decomposition | null = null;
  let execution: Execution | null = null;
  let verification: Verification | null = null;
  let decomposed = false;
  const notes: string[] = [];
  const stageTraces: StageTrace[] = [];
  const startedAt = Date.now();
  let verifiedDiff: { status: string; diff: string } | undefined;
  let receipts: Receipt[] = [];
  let stage: Stage = nextStage({ stage: 'orient', work }, decomposed);

  while (stage !== 'record' && !signal.aborted) {
    if (maxTokensPerCycle !== undefined && tokensUsed(usage) >= maxTokensPerCycle) {
      notes.push(`token budget of ${maxTokensPerCycle} reached before ${stage}`);
      break;
    }
    await markLoopPhase(projectPath, instanceId, `${stage}: ${idea.text}`);
    let outcome: StageOutcome;
    if (stage === 'decompose') {
      const run = await runStage({
        ...stageBase(ctx, 'planner', 'decompose'),
        system: `${baseSystem}\n\n${decomposeInstructions(config.decomposition.maxChildren)}`,
        prompt: await stageContext(ctx, gathered.input, 'decompose', config.contextBudgetChars),
        tools: toolsFor('decompose'),
        submit: { name: 'submit_decomposition', description: 'Submit the children for this idea.', schema: decompositionSchema },
        maxSteps: config.stepBudgets.decompose
      });
      addUsage(run.usage);
      stageTraces.push(run.trace);
      decomposition = run.result;
      decomposed = true;
      if (decomposition && decomposition.children.length > 0) {
        const applied = await applyDecomposition(graph, projectPath, idea.id, { ...decomposition, children: decomposition.children.slice(0, config.decomposition.maxChildren) }, gathered.linkableIds, config.decomposition.landingState);
        notes.push(`decomposed into ${applied.created.length} new and ${applied.linked.length} linked children`);
      } else {
        notes.push(decomposition ? `no decomposition: ${decomposition.rationale}` : 'decompose stage submitted nothing');
      }
      outcome = { stage: 'decompose', result: decomposition };
    } else if (stage === 'execute') {
      const executePrompt = await stageContext(ctx, gathered.input, 'execute', config.contextBudgetChars);
      const run = config.executor.backend === 'claude-code'
        ? await runClaudeCodeExecutor({
            executionPath,
            system: `${baseSystem}\n\n${EXECUTE_INSTRUCTIONS}\nUse your own tools to read, edit and test.`,
            prompt: executePrompt,
            config: config.executor.claudeCode,
            signal
          })
        : await runStage({
            ...stageBase(ctx, 'executor', 'execute'),
            system: `${baseSystem}\n\n${EXECUTE_INSTRUCTIONS}\nBefore editing, inspect git_status and read the relevant files; prefer str_replace or line_replace for small edits; run tests or typechecks with run_command. Destructive commands are refused.`,
            prompt: executePrompt,
            tools: toolsFor('execute'),
            submit: { name: 'submit_execution', description: 'Submit the outcome of this work cycle.', schema: executionSchema },
            maxSteps: config.stepBudgets.execute
          });
      addUsage(run.usage);
      stageTraces.push(run.trace);
      execution = run.result;
      notes.push(execution ? `execute: ${execution.outcome} — ${execution.summary}` : 'execute stage submitted nothing');
      outcome = { stage: 'execute', result: execution };
    } else if (stage === 'verify') {
      const [status, diff] = await Promise.all([
        describeOrError(() => gitStatus(executionPath)),
        describeOrError(() => gitDiff(executionPath, { limitChars: 20000 }))
      ]);
      receipts = await collectReceipts(executionPath, execution?.commands ?? [], config.receipts);
      verifiedDiff = { status, diff };
      const run = await runStage({
        ...stageBase(ctx, 'verifier', 'verify'),
        system: `${baseSystem}\n\nStage: verify. You did not do this work. Decide from the idea, the diff, the claimed evidence and the receipts whether the idea is achieved. The receipts are the executor's claimed commands, re-run by the harness just now; a failing receipt overrules a verified verdict. Run further checks where useful; do not edit files. verified: the evidence holds and covers the idea. failed: it does not hold or the work is wrong. unverifiable: you cannot check it from here. The diff is of the whole working tree and may contain unrelated changes by others.`,
        prompt: [
          `Idea:\n${idea.text}\n\n${idea.description ?? ''}`,
          `Executor summary:\n${execution?.summary ?? ''}`,
          `Claimed evidence:\n${execution?.evidence ?? ''}`,
          `Receipts (claimed commands re-run by the harness):\n${formatReceipts(receipts)}`,
          `Working tree status (new files show as ??; read them):\n${status}`,
          `Working tree diff:\n${diff}`
        ].join('\n\n'),
        tools: toolsFor('verify'),
        submit: { name: 'submit_verdict', description: 'Submit the verdict.', schema: verificationSchema },
        maxSteps: config.stepBudgets.verify
      });
      addUsage(run.usage);
      stageTraces.push(run.trace);
      verification = applyReceipts(run.result ?? { verdict: 'unverifiable', reasons: 'The verifier submitted no verdict.' }, receipts);
      notes.push(`verify: ${verification.verdict} — ${verification.reasons}`);
      outcome = { stage: 'verify', result: verification };
    } else {
      const parentEdges = (idea.supportedIdeas ?? []).flatMap((parentId) => {
        const parent = ideaById.get(parentId);
        const edge = parent?.supportingConnections?.find((connection) => connection.ideaId === idea.id);
        return parent && edge?.hypothesis ? [{ parentId, parentText: parent.text, hypothesis: edge.hypothesis }] : [];
      });
      if (parentEdges.length > 0) {
        const run = await runStage({
          ...stageBase(ctx, 'reflector', 'reflect'),
          system: `${baseSystem}\n\nStage: reflect. The idea is settled. For each parent edge, say whether its hypothesis held, given the outcome and evidence.`,
          prompt: [
            `Idea:\n${idea.text}`,
            `Outcome:\n${execution?.summary ?? ''}\n\nEvidence:\n${execution?.evidence ?? ''}\n\nVerifier:\n${verification?.reasons ?? ''}`,
            `Parent edges:\n${JSON.stringify(parentEdges, null, 2)}`
          ].join('\n\n'),
          tools: toolsFor('reflect'),
          submit: { name: 'submit_reflections', description: 'Submit one reflection per parent edge.', schema: reflectionSchema },
          maxSteps: config.stepBudgets.reflect
        });
        addUsage(run.usage);
        stageTraces.push(run.trace);
        const written = run.result
          ? await applyReflections(graph, projectPath, idea.id, run.result, new Set(parentEdges.map((edge) => edge.parentId)))
          : 0;
        notes.push(`reflect: ${written} parent edge(s)`);
      }
      outcome = { stage: 'reflect' };
    }
    const next = nextStage(outcome, decomposed);
    await logStage(ctx, `${stage} → ${next}`);
    stage = next;
  }

  // record
  const change = statusAfter(execution, verification);
  if (change && !signal.aborted) await applyStatus(graph, projectPath, idea.id, change);
  const costUsd = cycleCostUsd(stageTraces, config.prices);
  const unpriced = unpricedModels(stageTraces, config.prices);
  const tracePath = await writeCycleTrace(projectPath, {
    instanceId,
    startedAt,
    finishedAt: Date.now(),
    ideaId: idea.id,
    ideaText: idea.text,
    loop: { id: loop.id, name: loop.name, provider: loop.provider, model: loop.model, baseUrl: loop.baseUrl, roles: loop.roles, capabilities: loop.capabilities, systemPrompt: loop.systemPrompt },
    harnessConfig,
    stages: stageTraces,
    verifiedDiff,
    receipts,
    statusChange: change,
    notes,
    usage,
    costUsd
  });
  await appendLoopEvent(projectPath, instanceId, {
    role: 'tool',
    kind: 'status',
    content: [
      `Cycle on "${idea.text}": ${notes.join('; ') || 'no stage result'}.`,
      change ? `Status → ${change.state}.` : 'Status unchanged.',
      `Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out.`,
      costUsd !== null ? `Cost: $${costUsd.toFixed(4)}.` : `Cost unknown: no price in .bowman/harness.json for ${unpriced.join(', ')}.`,
      `Trace: ${path.basename(tracePath)}.`
    ].join(' ')
  });
}

/** Re-runs the executor's claimed commands (guarded, time-limited) so verification rests on observed exit codes. */
async function collectReceipts(executionPath: string, commands: string[], limits: HarnessConfig['receipts']): Promise<Receipt[]> {
  const receipts: Receipt[] = [];
  for (const command of commands.slice(0, limits.maxCommands)) {
    const result = await runCommand(executionPath, { command, timeoutMs: limits.timeoutMs });
    const output = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
    receipts.push({ command, exitCode: result.exitCode, refused: result.refused, outputTail: output.slice(-1500) });
  }
  return receipts;
}

async function describeOrError(read: () => Promise<unknown>): Promise<string> {
  try {
    const value = await read();
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch (error) {
    return `(unavailable: ${errorMessage(error).split('\n')[0]})`;
  }
}

function stageBase(ctx: CycleContext, role: keyof RoleModels, stage: string) {
  const { model, spec } = ctx.models[role];
  return { stage: `${stage} (${role})`, model, modelSpec: spec, projectPath: ctx.projectPath, instanceId: ctx.instanceId, signal: ctx.signal };
}

async function logStage(ctx: CycleContext, content: string) {
  await appendLoopEvent(ctx.projectPath, ctx.instanceId, { role: 'system', kind: 'event', content: `Stage ${content}` });
}

/** What the context compiler needs, gathered once per cycle. */
async function gatherContextInput(ctx: CycleContext, target: PrioritizedIdea, ideas: Idea[], ideaById: Map<string, Idea>) {
  const { projectPath, instanceId, loop, graph } = ctx;
  const idea = target.idea;
  const similar = (await graph.searchIdeas(`${idea.text} ${idea.description ?? ''}`, 12)).filter((candidate) => candidate.id !== idea.id);
  const humanMessages = await drainInbox(projectPath, instanceId);
  const instance = (await readLoopRuntimeState(projectPath)).instances.find((candidate) => candidate.id === instanceId);
  const recentEvents = (instance?.messages ?? []).filter((message) => message.kind !== 'text').slice(-12)
    .map((message) => `${message.kind}: ${message.content.split('\n')[0]!.slice(0, 300)}`);
  const association = await maybeFindAssociation(projectPath, graph.listIdeas, recentEvents.join('\n'), loop.associationChance ?? 0.1, [idea.id]);
  const { pathToRoot } = missionPathsToRoot(ideaById, idea, calculateIdeaValues(ideas).flowValues);

  const ancestors = ancestorIds(idea.id, ideaById);
  const input: ContextInput = {
    idea,
    ideaById,
    missionPath: pathToRoot.map((step) => step.id),
    similarIds: similar.map((candidate) => candidate.id),
    recentEvents,
    humanMessages: humanMessages.map((message) => `Human (${new Date(message.timestamp).toISOString()}): ${message.content}`),
    facts: {
      priority: target.priority.toFixed(4),
      value: target.value.toFixed(2),
      phase: target.phase.name,
      ...(association ? { 'association from recent loop events': JSON.stringify(association) } : {})
    }
  };
  return { input, linkableIds: new Set(similar.map((candidate) => candidate.id).filter((id) => !ancestors.has(id))) };
}

/** Compiles a stage's context and logs what it holds. */
async function stageContext(ctx: CycleContext, input: ContextInput, stage: 'decompose' | 'execute', budgetChars: number) {
  const compiled = compileContext(input, stage, budgetChars);
  await appendLoopEvent(ctx.projectPath, ctx.instanceId, {
    role: 'system',
    kind: 'event',
    content: `Context for ${stage}: ${compiled.chars} chars; ${compiled.included.join(', ')}${compiled.dropped.length ? `; dropped: ${compiled.dropped.join(', ')}` : ''}`
  });
  return compiled.text;
}

function ancestorIds(ideaId: string, ideaById: Map<string, Idea>): Set<string> {
  const seen = new Set<string>([ideaId]);
  const stack = [ideaId];
  while (stack.length > 0) {
    for (const parentId of ideaById.get(stack.pop()!)?.supportedIdeas ?? []) {
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      stack.push(parentId);
    }
  }
  return seen;
}
