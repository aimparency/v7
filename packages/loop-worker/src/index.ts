import fs from 'fs-extra';
import path from 'path';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { jsonSchema, streamText, stepCountIs, tool } from 'ai';
import {
  appendLoopEvent,
  buildCodeIndex,
  changeImpact,
  codeHeatmap,
  commitAimToPhase,
  createExperiment,
  createAim,
  drainInbox,
  getAimContext,
  getPrioritizedAims,
  gitDiff,
  gitStatus,
  graphHygiene,
  applyUnifiedPatch,
  lineReplace,
  listExperiments,
  listAimsFromFiles,
  listFiles,
  listPhasesFromFiles,
  maybeFindAssociation,
  mutateLoopRuntimeState,
  normalizeBowmanPath,
  patchWorkerState,
  proposePatch,
  readFileRange,
  readLoopRuntimeState,
  readWorkerState,
  runCommand,
  searchAimsSemanticLite,
  searchFiles,
  semanticCodeSearch,
  setLoopActivity,
  strReplace,
  symbolContext,
  updateAim,
  updateExperiment,
  type LoopDefinition,
  type LoopInboxMessage,
  type LoopInstance
} from 'agent-tools';
import { filterToolsByCapabilities } from './capabilities.js';
import { selectCycleTarget, throwIfStreamFailed } from './runtime-policy.js';

type LoopSecrets = {
  NVIDIA_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  LOOP_API_KEY?: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  let projectPath = '';
  let instanceId = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--projectPath' && args[i + 1]) {
      projectPath = args[++i];
    } else if (args[i] === '--instanceId' && args[i + 1]) {
      instanceId = args[++i];
    }
  }
  if (!projectPath || !instanceId) {
    throw new Error('Usage: loop-worker --projectPath <project-or-.bowman> --instanceId <uuid>');
  }
  return { projectPath: normalizeBowmanPath(projectPath), instanceId };
}

function apiKeyFor(loop: LoopDefinition, secrets: LoopSecrets): string | undefined {
  if (loop.provider === 'nvidia') return secrets.NVIDIA_API_KEY;
  if (loop.provider === 'openrouter') return secrets.OPENROUTER_API_KEY;
  return secrets.LOOP_API_KEY;
}

async function readSecrets(projectPath: string): Promise<LoopSecrets> {
  try {
    return await fs.readJson(path.join(projectPath, 'secrets.json')) as LoopSecrets;
  } catch {
    return {};
  }
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

async function markInstanceStatus(projectPath: string, instanceId: string, status: LoopInstance['status']) {
  await mutateLoopRuntimeState(projectPath, (state) => {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (!instance) return;
    instance.status = status;
    instance.updatedAt = Date.now();
  });
  await patchWorkerState(projectPath, instanceId, { status, updatedAt: Date.now() });
}

async function markLoopPhase(projectPath: string, instanceId: string, phase: string) {
  await setLoopActivity(projectPath, instanceId, phase);
}

async function readLoopAndInstance(projectPath: string, instanceId: string) {
  const runtime = await readLoopRuntimeState(projectPath);
  const instance = runtime.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) throw new Error(`Loop instance not found: ${instanceId}`);
  const loop = runtime.loops.find((candidate) => candidate.id === instance.loopId);
  if (!loop) throw new Error(`Loop definition not found: ${instance.loopId}`);
  return { loop, instance };
}

function summarizeInbox(messages: LoopInboxMessage[]): string {
  if (messages.length === 0) return '';
  return messages
    .map((message) => `Human (${new Date(message.timestamp).toISOString()}): ${message.content}`)
    .join('\n');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function describeProviderError(error: unknown, loop: LoopDefinition): string {
  const message = errorMessage(error);
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const statusCode = details.statusCode ?? details.status ?? details.code;
  const lines = [
    `LLM request failed: ${message}`,
    `provider: ${loop.provider}`,
    `model: ${loop.model}`,
    `baseUrl: ${loop.baseUrl}`
  ];
  if (statusCode) lines.push(`status/code: ${String(statusCode)}`);
  if (/unauthorized|401|invalid.?api.?key|authentication/i.test(message)) {
    const keyName = loop.provider === 'nvidia'
      ? 'NVIDIA_API_KEY'
      : loop.provider === 'openrouter'
        ? 'OPENROUTER_API_KEY'
        : 'LOOP_API_KEY';
    lines.push(`likely cause: ${keyName} is missing, invalid, expired, or not accepted by this endpoint/model.`);
    lines.push('Check the loop configuration and .bowman/secrets.json for this project.');
  }
  return lines.join('\n');
}

function summarizeToolOutput(output: unknown): string {
  const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  return text.length > 1200 ? `${text.slice(0, 1200)}\n...[truncated ${text.length - 1200} chars]` : text;
}

async function waitForHumanAnswer(projectPath: string, instanceId: string, requestId: string, signal: AbortSignal) {
  while (!signal.aborted) {
    const state = await readWorkerState(projectPath, instanceId);
    if (state?.stopRequested) return null;
    const messages = await drainInbox(projectPath, instanceId);
    const answer = messages.find((message) => !message.replyToRequestId || message.replyToRequestId === requestId) ?? messages[0];
    if (answer) return answer;
    await sleep(1500, signal);
  }
  return null;
}

async function evaluateStopPolicy(projectPath: string, instance: LoopInstance) {
  if (instance.stopPolicy === 'never') return null;
  if (instance.stopPolicy === 'asap') {
    return { status: 'stopped' as const, message: null };
  }

  if (instance.stopPolicy === 'target_halted') {
    if (!instance.targetAimId) return null;
    const aims = await listAimsFromFiles(projectPath);
    const aim = aims.find((candidate) => candidate.id === instance.targetAimId);
    if (aim?.status.state === 'halted') {
      return { status: 'done' as const, message: `Target aim halted: ${aim.text}` };
    }
    return null;
  }

  if (!instance.targetPhaseId) return null;
  const [aims, phases] = await Promise.all([
    listAimsFromFiles(projectPath),
    listPhasesFromFiles(projectPath)
  ]);
  const phase = phases.find((candidate) => candidate.id === instance.targetPhaseId);
  if (!phase || (phase.commitments ?? []).length === 0) return null;
  const aimById = new Map(aims.map((aim) => [aim.id, aim]));
  const ongoingStates = new Set(['open', 'in-progress', 'partially', 'human-dependent']);
  const ongoing = (phase.commitments ?? [])
    .map((aimId) => aimById.get(aimId))
    .filter((aim) => aim && ongoingStates.has(aim.status.state));
  if (ongoing.length === 0) {
    return { status: 'done' as const, message: `Target phase done: ${phase.name}` };
  }
  return null;
}

async function waitForNextCycle(projectPath: string, instanceId: string, loop: LoopDefinition, signal: AbortSignal) {
  await markLoopPhase(projectPath, instanceId, `cooldown (${loop.intervalSeconds}s)`);
  const until = Date.now() + loop.intervalSeconds * 1000;
  while (!signal.aborted && Date.now() < until) {
    const workerState = await readWorkerState(projectPath, instanceId);
    if (workerState?.stopRequested) break;
    const { instance } = await readLoopAndInstance(projectPath, instanceId);
    const stopDecision = await evaluateStopPolicy(projectPath, instance);
    if (stopDecision) return stopDecision;
    await sleep(Math.min(1000, Math.max(0, until - Date.now())), signal);
  }
  return null;
}

async function runCycle(projectPath: string, instanceId: string, loop: LoopDefinition, signal: AbortSignal) {
  const executionPath = loop.worktreePath || projectPath;
  await markLoopPhase(projectPath, instanceId, 'checking API credentials');
  const secrets = await readSecrets(projectPath);
  const apiKey = apiKeyFor(loop, secrets);
  if (!apiKey) throw new Error(`Missing API key for provider ${loop.provider}.`);

  await markLoopPhase(projectPath, instanceId, 'orienting in aim graph');
  const runtimeState = await readLoopRuntimeState(projectPath);
  const currentInstance = runtimeState.instances.find((candidate) => candidate.id === instanceId);
  const prioritized = await getPrioritizedAims(
    projectPath,
    currentInstance?.targetAimId ? Number.MAX_SAFE_INTEGER : 5,
    currentInstance?.targetPhaseId
  );
  const target = selectCycleTarget(prioritized, currentInstance?.targetAimId);
  if (!target) throw new Error('No open prioritized aim found in the active phase.');

  const context = await getAimContext(projectPath, target.aim.id);
  const related = await searchAimsSemanticLite(
    projectPath,
    `${target.aim.text} ${target.aim.description ?? ''}`,
    8
  );
  const pendingHumanMessages = await drainInbox(projectPath, instanceId);
  const stateText = (currentInstance?.messages ?? [])
    .slice(-12)
    .map((message) => `${message.kind}: ${message.content}`)
    .join('\n');
  const association = await maybeFindAssociation(
    projectPath,
    stateText,
    loop.associationChance ?? 0.1,
    [target.aim.id]
  );

  await appendLoopEvent(projectPath, instanceId, {
    role: 'tool',
    kind: 'status',
    content: `Selected aim: ${target.aim.text}`
  });

  const provider = createOpenAICompatible({
    name: loop.provider,
    baseURL: loop.baseUrl,
    apiKey
  });

  const systemText = [
    loop.systemPrompt,
    '',
    'You are running inside an Aimparency loop worker.',
    'Start each cycle by orienting in the aim graph. Before acting, decide whether the aim is atomic enough.',
    'If an aim is too broad, create smaller child aims or mark the current aim human-dependent instead of pretending it is actionable.',
    'Humans should be asked for help only on severe blockers. Usually, use the graph tools to record ambiguity and move to clearer work.',
    'Assume people run Aimparency on their own computers unless an aim explicitly asks for remote hosting.',
    '',
    `Enabled optional capability packs: ${loop.capabilities.length > 0 ? loop.capabilities.join(', ') : 'none'}.`,
    'Core aim-graph orientation and delegation tools are always available.',
    'Before editing, inspect git_status and read the relevant files. Prefer str_replace or line_replace for small edits. Use run_command for tests/typechecks. Destructive commands are refused.'
  ].join('\n');
  const promptText = [
    `Current aim:\n${JSON.stringify({
      id: target.aim.id,
      text: target.aim.text,
      description: target.aim.description,
      priority: target.priority,
      value: target.value,
      cost: target.cost,
      phase: target.phase.name
    }, null, 2)}`,
    `Aim context:\n${JSON.stringify(context, null, 2)}`,
    `Related aims:\n${JSON.stringify(related, null, 2)}`,
    association ? `Association surfaced from recent loop state messages:\n${JSON.stringify(association, null, 2)}` : '',
    pendingHumanMessages.length > 0 ? `Pending human messages:\n${summarizeInbox(pendingHumanMessages)}` : ''
  ].filter(Boolean).join('\n\n');
  await appendLoopEvent(projectPath, instanceId, {
    role: 'system',
    kind: 'event',
    content: [
      'Sending LLM request:',
      `provider: ${loop.provider}`,
      `model: ${loop.model}`,
      `baseUrl: ${loop.baseUrl}`,
      '',
      '[system]',
      systemText,
      '',
      '[prompt]',
      promptText
    ].join('\n')
  });

  const availableTools: Record<string, any> = {
      status_report: tool({
        description: 'Post a brief user-facing status report about what happened since the last status report. Max 3 sentences.',
        inputSchema: jsonSchema<{ message: string }>({
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false
        }),
        execute: async ({ message }) => {
          await appendLoopEvent(projectPath, instanceId, { role: 'tool', kind: 'status', content: message });
          return { ok: true };
        }
      }),
      human_action_required: tool({
        description: 'Ask the human for help only for severe blockers. Pauses the loop until the human answers.',
        inputSchema: jsonSchema<{ message: string }>({
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false
        }),
        execute: async ({ message }) => {
          const request = await appendLoopEvent(projectPath, instanceId, {
            role: 'tool',
            kind: 'human_action_required',
            content: message
          });
          await markInstanceStatus(projectPath, instanceId, 'waiting_for_human');
          await patchWorkerState(projectPath, instanceId, {
            status: 'waiting_for_human',
            waitingRequestId: request.id,
            waitingPrompt: message
          });
          const answer = await waitForHumanAnswer(projectPath, instanceId, request.id, signal);
          if (!answer) return { ok: false, stopped: true };
          await markInstanceStatus(projectPath, instanceId, 'running');
          await patchWorkerState(projectPath, instanceId, {
            status: 'running',
            waitingRequestId: undefined,
            waitingPrompt: undefined
          });
          return { ok: true, answer: answer.content };
        }
      }),
      external_action_required: tool({
        description: 'Wait for an external system, institution, or third party. State exactly what evidence or event will unblock the loop.',
        inputSchema: jsonSchema<{ message: string }>({
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false
        }),
        execute: async ({ message }) => {
          const request = await appendLoopEvent(projectPath, instanceId, {
            role: 'tool',
            kind: 'external_action_required',
            content: message
          });
          await markInstanceStatus(projectPath, instanceId, 'waiting_for_external');
          await patchWorkerState(projectPath, instanceId, {
            status: 'waiting_for_external',
            waitingRequestId: request.id,
            waitingPrompt: message
          });
          const evidence = await waitForHumanAnswer(projectPath, instanceId, request.id, signal);
          if (!evidence) return { ok: false, stopped: true };
          await markInstanceStatus(projectPath, instanceId, 'running');
          await patchWorkerState(projectPath, instanceId, {
            status: 'running',
            waitingRequestId: undefined,
            waitingPrompt: undefined
          });
          return { ok: true, evidence: evidence.content };
        }
      }),
      get_prioritized_aims: tool({
        description: 'Return open aims in active phase ranked by Aimparency priority.',
        inputSchema: jsonSchema<{ limit?: number }>({
          type: 'object',
          properties: { limit: { type: 'number' } },
          additionalProperties: false
        }),
        execute: async ({ limit }) => getPrioritizedAims(projectPath, limit ?? 10, currentInstance?.targetPhaseId)
      }),
      get_aim_context: tool({
        description: 'Return an aim, parents, children, and root path context.',
        inputSchema: jsonSchema<{ aimId: string }>({
          type: 'object',
          properties: { aimId: { type: 'string' } },
          required: ['aimId'],
          additionalProperties: false
        }),
        execute: async ({ aimId }) => getAimContext(projectPath, aimId)
      }),
      search_aims_semantic: tool({
        description: 'Find related aims. Current v1 uses lightweight text matching until embedding core is extracted.',
        inputSchema: jsonSchema<{ query: string; limit?: number }>({
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'number' } },
          required: ['query'],
          additionalProperties: false
        }),
        execute: async ({ query, limit }) => searchAimsSemanticLite(projectPath, query, limit ?? 8)
      }),
      graph_hygiene: tool({
        description: 'Return graph hygiene signals: floating aims, uncommitted open aims, mega parents.',
        inputSchema: jsonSchema<Record<string, never>>({
          type: 'object',
          properties: {},
          additionalProperties: false
        }),
        execute: async () => graphHygiene(projectPath)
      }),
      experiment: tool({
        description: 'Create, list, or update durable experiments. Define predictions and stop conditions before acting; append evidence and belief updates after observing results.',
        inputSchema: jsonSchema<{
          action: 'create' | 'list' | 'update';
          experimentId?: string;
          aimIds?: string[];
          hypothesis?: string;
          prediction?: string;
          expectedCost?: string;
          expectedUpside?: string;
          successMetric?: string;
          stopCondition?: string;
          status?: 'draft' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'inconclusive' | 'stopped';
          evidence?: { summary: string; ref?: string; observedAt?: number };
          result?: string;
          beliefUpdate?: { previousConfidence?: number; newConfidence: number; reason: string };
          economicOutcomeRef?: string;
          nextDecision?: string;
        }>({
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'list', 'update'] },
            experimentId: { type: 'string' },
            aimIds: { type: 'array', items: { type: 'string' } },
            hypothesis: { type: 'string' },
            prediction: { type: 'string' },
            expectedCost: { type: 'string' },
            expectedUpside: { type: 'string' },
            successMetric: { type: 'string' },
            stopCondition: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'running', 'waiting', 'succeeded', 'failed', 'inconclusive', 'stopped'] },
            evidence: {
              type: 'object',
              properties: {
                summary: { type: 'string' },
                ref: { type: 'string' },
                observedAt: { type: 'number' }
              },
              required: ['summary'],
              additionalProperties: false
            },
            result: { type: 'string' },
            beliefUpdate: {
              type: 'object',
              properties: {
                previousConfidence: { type: 'number' },
                newConfidence: { type: 'number' },
                reason: { type: 'string' }
              },
              required: ['newConfidence', 'reason'],
              additionalProperties: false
            },
            economicOutcomeRef: { type: 'string' },
            nextDecision: { type: 'string' }
          },
          required: ['action'],
          additionalProperties: false
        }),
        execute: async (input) => {
          if (input.action === 'list') return listExperiments(projectPath);
          if (input.action === 'create') {
            const required = [
              'hypothesis',
              'prediction',
              'expectedCost',
              'expectedUpside',
              'successMetric',
              'stopCondition'
            ] as const;
            const missing = required.filter((field) => !input[field]?.trim());
            if (missing.length > 0) throw new Error(`Missing experiment fields: ${missing.join(', ')}`);
            return createExperiment(projectPath, {
              aimIds: input.aimIds,
              hypothesis: input.hypothesis!,
              prediction: input.prediction!,
              expectedCost: input.expectedCost!,
              expectedUpside: input.expectedUpside!,
              successMetric: input.successMetric!,
              stopCondition: input.stopCondition!,
              status: input.status
            });
          }
          if (!input.experimentId) throw new Error('experimentId is required for update');
          return updateExperiment(projectPath, input.experimentId, {
            status: input.status,
            evidence: input.evidence ? {
              ...input.evidence,
              observedAt: input.evidence.observedAt ?? Date.now()
            } : undefined,
            result: input.result,
            beliefUpdate: input.beliefUpdate,
            economicOutcomeRef: input.economicOutcomeRef,
            nextDecision: input.nextDecision
          });
        }
      }),
      code_intelligence: tool({
        description: 'Inspect code through one compact interface: index builds local code embeddings; semantic searches them by meaning; heatmap combines lexical matches and churn; symbol finds definitions/references; impact finds dependents and tests.',
        inputSchema: jsonSchema<{
          mode: 'index' | 'semantic' | 'heatmap' | 'symbol' | 'impact';
          query?: string;
          limit?: number;
          maxFiles?: number;
          maxChunks?: number;
        }>({
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['index', 'semantic', 'heatmap', 'symbol', 'impact'] },
            query: { type: 'string' },
            limit: { type: 'number' },
            maxFiles: { type: 'number' },
            maxChunks: { type: 'number' }
          },
          required: ['mode'],
          additionalProperties: false
        }),
        execute: async ({ mode, query, limit, maxFiles, maxChunks }) => {
          if (mode === 'index') return buildCodeIndex(executionPath, { maxFiles, maxChunks });
          if (!query) throw new Error(`query is required for code_intelligence mode=${mode}`);
          if (mode === 'semantic') return semanticCodeSearch(executionPath, query, limit);
          if (mode === 'heatmap') return codeHeatmap(executionPath, query, limit);
          if (mode === 'symbol') return symbolContext(executionPath, query, limit);
          return changeImpact(executionPath, query, limit);
        }
      }),
      create_aim: tool({
        description: 'Create a child/supporting aim or newly clarified aim.',
        inputSchema: jsonSchema<{ text: string; description?: string; supportedAims?: string[]; phaseId?: string; cost?: number; intrinsicValue?: number }>({
          type: 'object',
          properties: {
            text: { type: 'string' },
            description: { type: 'string' },
            supportedAims: { type: 'array', items: { type: 'string' } },
            phaseId: { type: 'string' },
            cost: { type: 'number' },
            intrinsicValue: { type: 'number' }
          },
          required: ['text'],
          additionalProperties: false
        }),
        execute: async (input) => createAim(projectPath, input)
      }),
      update_aim: tool({
        description: 'Update aim text/description/status/cost/value. Use human-dependent for ambiguous aims instead of asking humans too often.',
        inputSchema: jsonSchema<{ aimId: string; text?: string; description?: string; status?: { state: string; comment?: string }; cost?: number; intrinsicValue?: number }>({
          type: 'object',
          properties: {
            aimId: { type: 'string' },
            text: { type: 'string' },
            description: { type: 'string' },
            status: {
              type: 'object',
              properties: { state: { type: 'string' }, comment: { type: 'string' } },
              required: ['state'],
              additionalProperties: false
            },
            cost: { type: 'number' },
            intrinsicValue: { type: 'number' }
          },
          required: ['aimId'],
          additionalProperties: false
        }),
        execute: async ({ aimId, status, ...patch }) => updateAim(projectPath, aimId, {
          ...patch,
          status: status ? { state: status.state, comment: status.comment ?? '', date: Date.now() } : undefined
        })
      }),
      commit_aim_to_phase: tool({
        description: 'Commit an existing aim to a phase so it becomes visible to phase-based prioritization.',
        inputSchema: jsonSchema<{ aimId: string; phaseId: string }>({
          type: 'object',
          properties: {
            aimId: { type: 'string' },
            phaseId: { type: 'string' }
          },
          required: ['aimId', 'phaseId'],
          additionalProperties: false
        }),
        execute: async ({ aimId, phaseId }) => commitAimToPhase(projectPath, aimId, phaseId)
      }),
      list_files: tool({
        description: 'List project files using rg --files when available.',
        inputSchema: jsonSchema<{ directory?: string; limit?: number }>({
          type: 'object',
          properties: { directory: { type: 'string' }, limit: { type: 'number' } },
          additionalProperties: false
        }),
        execute: async (input) => listFiles(executionPath, input)
      }),
      search_files: tool({
        description: 'Search files with rg line numbers and configurable context.',
        inputSchema: jsonSchema<{ query: string; directory?: string; context?: number; glob?: string; limitChars?: number }>({
          type: 'object',
          properties: {
            query: { type: 'string' },
            directory: { type: 'string' },
            context: { type: 'number' },
            glob: { type: 'string' },
            limitChars: { type: 'number' }
          },
          required: ['query'],
          additionalProperties: false
        }),
        execute: async (input) => searchFiles(executionPath, input)
      }),
      read_file: tool({
        description: 'Read a file range with line numbers.',
        inputSchema: jsonSchema<{ path: string; startLine?: number; maxLines?: number }>({
          type: 'object',
          properties: { path: { type: 'string' }, startLine: { type: 'number' }, maxLines: { type: 'number' } },
          required: ['path'],
          additionalProperties: false
        }),
        execute: async (input) => readFileRange(executionPath, input)
      }),
      git_status: tool({
        description: 'Return git status --short for the project.',
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
        execute: async () => gitStatus(executionPath)
      }),
      git_diff: tool({
        description: 'Return git diff, optionally for one path or staged changes.',
        inputSchema: jsonSchema<{ path?: string; staged?: boolean; limitChars?: number }>({
          type: 'object',
          properties: { path: { type: 'string' }, staged: { type: 'boolean' }, limitChars: { type: 'number' } },
          additionalProperties: false
        }),
        execute: async (input) => gitDiff(executionPath, input)
      }),
      run_command: tool({
        description: 'Run a shell command in the project. Risky destructive commands are refused. Use for tests, builds, typechecks, and read-only shell inspection.',
        inputSchema: jsonSchema<{ command: string; cwd?: string; timeoutMs?: number; maxOutputChars?: number }>({
          type: 'object',
          properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            timeoutMs: { type: 'number' },
            maxOutputChars: { type: 'number' }
          },
          required: ['command'],
          additionalProperties: false
        }),
        execute: async (input) => runCommand(executionPath, input)
      }),
      propose_patch: tool({
        description: 'Record a proposed unified diff and summary before applying it.',
        inputSchema: jsonSchema<{ summary: string; unifiedDiff: string }>({
          type: 'object',
          properties: { summary: { type: 'string' }, unifiedDiff: { type: 'string' } },
          required: ['summary', 'unifiedDiff'],
          additionalProperties: false
        }),
        execute: async (input) => proposePatch(input)
      }),
      apply_patch: tool({
        description: 'Apply a unified diff after git apply --check succeeds.',
        inputSchema: jsonSchema<{ unifiedDiff: string }>({
          type: 'object',
          properties: { unifiedDiff: { type: 'string' } },
          required: ['unifiedDiff'],
          additionalProperties: false
        }),
        execute: async (input) => applyUnifiedPatch(executionPath, input)
      }),
      str_replace: tool({
        description: 'Replace one unique string in a project file.',
        inputSchema: jsonSchema<{ path: string; oldString: string; newString: string }>({
          type: 'object',
          properties: { path: { type: 'string' }, oldString: { type: 'string' }, newString: { type: 'string' } },
          required: ['path', 'oldString', 'newString'],
          additionalProperties: false
        }),
        execute: async (input) => strReplace(executionPath, input)
      }),
      line_replace: tool({
        description: 'Replace a line range, guarded by exact expected first and last line text.',
        inputSchema: jsonSchema<{ path: string; startLine: number; lineCount: number; expectedFirstLine: string; expectedLastLine: string; replacement: string }>({
          type: 'object',
          properties: {
            path: { type: 'string' },
            startLine: { type: 'number' },
            lineCount: { type: 'number' },
            expectedFirstLine: { type: 'string' },
            expectedLastLine: { type: 'string' },
            replacement: { type: 'string' }
          },
          required: ['path', 'startLine', 'lineCount', 'expectedFirstLine', 'expectedLastLine', 'replacement'],
          additionalProperties: false
        }),
        execute: async (input) => lineReplace(executionPath, input)
      })
  };
  const enabledTools = filterToolsByCapabilities(availableTools, loop.capabilities);

  const result = streamText({
    model: provider(loop.model),
    abortSignal: signal,
    system: systemText,
    prompt: promptText,
    stopWhen: stepCountIs(10),
    tools: enabledTools
  } as any);

  let finalText = '';
  let reasoningText = '';
  let finishReason = 'unknown';
  let rawFinishReason = '';
  let sawStreamPart = false;
  const toolCalls: string[] = [];
  const streamErrors: string[] = [];
  let flushedTextLength = 0;
  let lastTextFlushAt = Date.now();
  const flushText = async (force = false) => {
    const rawText = finalText.slice(flushedTextLength);
    if (!rawText.trim()) return;
    const enoughTime = Date.now() - lastTextFlushAt >= 1000;
    const enoughText = rawText.length >= 80;
    const sentenceBoundary = /[.!?]\s$/.test(rawText);
    if (!force && !enoughTime && !enoughText && !sentenceBoundary) return;
    flushedTextLength = finalText.length;
    lastTextFlushAt = Date.now();
    await appendLoopEvent(projectPath, instanceId, {
      role: 'assistant',
      kind: 'text',
      content: rawText
    });
  };
  await markLoopPhase(projectPath, instanceId, `waiting for LLM endpoint response (${loop.provider} / ${loop.model})`);
  for await (const part of result.fullStream) {
    if (!sawStreamPart) {
      sawStreamPart = true;
      await markLoopPhase(projectPath, instanceId, 'streaming LLM response');
    }
    if (part.type === 'text-delta') {
      finalText += part.text;
      await flushText(false);
    } else if (part.type === 'reasoning-delta') {
      reasoningText += part.text;
    } else if (part.type === 'tool-call') {
      await flushText(true);
      toolCalls.push(String(part.toolName));
      await setLoopActivity(projectPath, instanceId, `calling tool: ${String(part.toolName)}`);
      await appendLoopEvent(projectPath, instanceId, {
        role: 'system',
        kind: 'event',
        content: `Calling tool: ${String(part.toolName)}\n${summarizeToolOutput(part.input)}`
      });
    } else if (part.type === 'tool-error') {
      streamErrors.push(`Tool failed: ${String(part.toolName)}\n${errorMessage(part.error)}`);
    } else if (part.type === 'tool-result') {
      await setLoopActivity(projectPath, instanceId, `tool completed: ${String(part.toolName)}`);
      await appendLoopEvent(projectPath, instanceId, {
        role: 'system',
        kind: 'event',
        content: `Tool result: ${String(part.toolName)}\n${summarizeToolOutput(part.output)}`
      });
    } else if (part.type === 'error') {
      streamErrors.push(describeProviderError(part.error, loop));
    } else if (part.type === 'finish') {
      finishReason = part.finishReason;
      rawFinishReason = part.rawFinishReason ?? '';
    }
  }
  await flushText(true);
  if (streamErrors.length > 0) {
    await appendLoopEvent(projectPath, instanceId, {
      role: 'system',
      kind: 'error',
      content: streamErrors.join('\n')
    });
  }
  throwIfStreamFailed(streamErrors);
  if (!finalText.trim() && toolCalls.length === 0 && streamErrors.length === 0) {
    await appendLoopEvent(projectPath, instanceId, {
      role: 'system',
      kind: 'error',
      content: [
        'Model returned no visible output and called no tools.',
        `finishReason: ${finishReason}${rawFinishReason ? ` (${rawFinishReason})` : ''}`,
        reasoningText.trim() ? `reasoning: ${reasoningText.trim().slice(0, 1200)}` : 'reasoning: empty',
        'This usually means the provider/model response shape is not fully compatible with the AI SDK adapter, or the model chose to emit only hidden reasoning.'
      ].join('\n')
    });
  } else if (!finalText.trim() && toolCalls.length > 0) {
    await appendLoopEvent(projectPath, instanceId, {
      role: 'system',
      kind: 'event',
      content: `Model called tools: ${[...new Set(toolCalls)].join(', ')}.`
    });
  }
}

async function main() {
  const { projectPath, instanceId } = parseArgs();
  const abortController = new AbortController();
  let stopping = false;
  let finalStatus: LoopInstance['status'] = 'stopped';
  let finalMessage: string | null = 'Loop worker stopped.';
  const stop = () => {
    stopping = true;
    abortController.abort();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const startedAt = Date.now();
  await patchWorkerState(projectPath, instanceId, {
    status: 'running',
    pid: process.pid,
    startedAt,
    updatedAt: startedAt,
    heartbeatAt: startedAt,
    stopRequested: false,
    error: undefined
  });
  await markInstanceStatus(projectPath, instanceId, 'running');
  const startupLoop = (await readLoopAndInstance(projectPath, instanceId)).loop;
  const executionNote = startupLoop.worktreePath ? ` Coding tools use worktree ${startupLoop.worktreePath}.` : '';
  await appendLoopEvent(projectPath, instanceId, { role: 'system', kind: 'event', content: `Loop worker started (pid ${process.pid}).${executionNote}` });
  await markLoopPhase(projectPath, instanceId, 'started');

  const heartbeat = setInterval(() => {
    void patchWorkerState(projectPath, instanceId, {
      status: stopping ? 'stopped' : 'running',
      pid: process.pid,
      heartbeatAt: Date.now()
    }).catch(() => {});
  }, 5000);

  try {
    while (!abortController.signal.aborted) {
      const workerState = await readWorkerState(projectPath, instanceId);
      if (workerState?.stopRequested) break;
      const { loop, instance } = await readLoopAndInstance(projectPath, instanceId);
      if (instance.status === 'stopped') break;
      await markLoopPhase(projectPath, instanceId, 'checking stop policy');
      const stopDecision = await evaluateStopPolicy(projectPath, instance);
      if (stopDecision) {
        finalStatus = stopDecision.status;
        finalMessage = stopDecision.message;
        break;
      }
      if (instance.status !== 'running' && instance.status !== 'waiting_for_human' && instance.status !== 'waiting_for_external') {
        await markInstanceStatus(projectPath, instanceId, 'running');
      }
      await markLoopPhase(projectPath, instanceId, 'running cycle');
      await runCycle(projectPath, instanceId, loop, abortController.signal);
      const nextState = await readWorkerState(projectPath, instanceId);
      if (nextState?.stopRequested || abortController.signal.aborted) break;
      const { instance: refreshedInstance } = await readLoopAndInstance(projectPath, instanceId);
      const postCycleStopDecision = await evaluateStopPolicy(projectPath, refreshedInstance);
      if (postCycleStopDecision) {
        finalStatus = postCycleStopDecision.status;
        finalMessage = postCycleStopDecision.message;
        break;
      }
      await appendLoopEvent(projectPath, instanceId, {
        role: 'system',
        kind: 'event',
        content: `Cycle complete. Waiting ${loop.intervalSeconds}s.`
      });
      const waitStopDecision = await waitForNextCycle(projectPath, instanceId, loop, abortController.signal);
      if (waitStopDecision) {
        finalStatus = waitStopDecision.status;
        finalMessage = waitStopDecision.message;
        break;
      }
    }
    await markInstanceStatus(projectPath, instanceId, finalStatus);
    await patchWorkerState(projectPath, instanceId, { status: finalStatus, stopRequested: false });
    await markLoopPhase(projectPath, instanceId, finalStatus === 'done' ? 'done' : 'stopped');
    if (finalMessage) {
      await appendLoopEvent(projectPath, instanceId, { role: 'system', kind: 'event', content: finalMessage });
    }
  } catch (error) {
    let message = errorMessage(error);
    try {
      const { loop } = await readLoopAndInstance(projectPath, instanceId);
      message = describeProviderError(error, loop);
    } catch {
      // Keep the generic message if loop config cannot be read.
    }
    await markInstanceStatus(projectPath, instanceId, abortController.signal.aborted ? 'stopped' : 'error');
    await patchWorkerState(projectPath, instanceId, {
      status: abortController.signal.aborted ? 'stopped' : 'error',
      error: message
    });
    await appendLoopEvent(projectPath, instanceId, {
      role: 'system',
      kind: abortController.signal.aborted ? 'event' : 'error',
      content: abortController.signal.aborted ? 'Loop worker stopped.' : message
    });
    if (!abortController.signal.aborted) process.exitCode = 1;
  } finally {
    clearInterval(heartbeat);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
