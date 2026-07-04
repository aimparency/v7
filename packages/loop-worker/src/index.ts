import fs from 'fs-extra';
import path from 'path';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { jsonSchema, streamText, stepCountIs, tool } from 'ai';
import {
  appendLoopEvent,
  commitAimToPhase,
  createAim,
  drainInbox,
  getAimContext,
  getPrioritizedAims,
  gitDiff,
  gitStatus,
  graphHygiene,
  applyUnifiedPatch,
  lineReplace,
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
  strReplace,
  updateAim,
  type LoopDefinition,
  type LoopInboxMessage,
  type LoopInstance
} from 'agent-tools';

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
  const secrets = await readSecrets(projectPath);
  const apiKey = apiKeyFor(loop, secrets);
  if (!apiKey) throw new Error(`Missing API key for provider ${loop.provider}.`);

  const runtimeState = await readLoopRuntimeState(projectPath);
  const currentInstance = runtimeState.instances.find((candidate) => candidate.id === instanceId);
  const prioritized = await getPrioritizedAims(projectPath, 5, currentInstance?.targetPhaseId);
  const target = currentInstance?.targetAimId
    ? prioritized.find((candidate) => candidate.aim.id === currentInstance.targetAimId)
    : prioritized[0];
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
  const association = await maybeFindAssociation(projectPath, stateText, loop.associationChance ?? 0.1);

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

  const result = streamText({
    model: provider(loop.model),
    abortSignal: signal,
    system: [
      loop.systemPrompt,
      '',
      'You are running inside an Aimparency loop worker.',
      'Start each cycle by orienting in the aim graph. Before acting, decide whether the aim is atomic enough.',
      'If an aim is too broad, create smaller child aims or mark the current aim human-dependent instead of pretending it is actionable.',
      'Humans should be asked for help only on severe blockers. Usually, use the graph tools to record ambiguity and move to clearer work.',
      'Assume people run Aimparency on their own computers unless an aim explicitly asks for remote hosting.',
      '',
      'Available tools include aim graph tools plus coding tools: list_files, search_files, read_file, git_status, git_diff, run_command, propose_patch, apply_patch, str_replace, and line_replace.',
      'Before editing, inspect git_status and read the relevant files. Prefer str_replace or line_replace for small edits. Use run_command for tests/typechecks. Destructive commands are refused.'
    ].join('\n'),
    prompt: [
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
      pendingHumanMessages.length > 0 ? `Pending human messages:\n${summarizeInbox(pendingHumanMessages)}` : '',
      'Perform one bounded cycle of useful work. Prefer graph updates and status reports over broad speculation.'
    ].filter(Boolean).join('\n\n'),
    stopWhen: stepCountIs(10),
    tools: {
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
        execute: async (input) => listFiles(projectPath, input)
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
        execute: async (input) => searchFiles(projectPath, input)
      }),
      read_file: tool({
        description: 'Read a file range with line numbers.',
        inputSchema: jsonSchema<{ path: string; startLine?: number; maxLines?: number }>({
          type: 'object',
          properties: { path: { type: 'string' }, startLine: { type: 'number' }, maxLines: { type: 'number' } },
          required: ['path'],
          additionalProperties: false
        }),
        execute: async (input) => readFileRange(projectPath, input)
      }),
      git_status: tool({
        description: 'Return git status --short for the project.',
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
        execute: async () => gitStatus(projectPath)
      }),
      git_diff: tool({
        description: 'Return git diff, optionally for one path or staged changes.',
        inputSchema: jsonSchema<{ path?: string; staged?: boolean; limitChars?: number }>({
          type: 'object',
          properties: { path: { type: 'string' }, staged: { type: 'boolean' }, limitChars: { type: 'number' } },
          additionalProperties: false
        }),
        execute: async (input) => gitDiff(projectPath, input)
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
        execute: async (input) => runCommand(projectPath, input)
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
        execute: async (input) => applyUnifiedPatch(projectPath, input)
      }),
      str_replace: tool({
        description: 'Replace one unique string in a project file.',
        inputSchema: jsonSchema<{ path: string; oldString: string; newString: string }>({
          type: 'object',
          properties: { path: { type: 'string' }, oldString: { type: 'string' }, newString: { type: 'string' } },
          required: ['path', 'oldString', 'newString'],
          additionalProperties: false
        }),
        execute: async (input) => strReplace(projectPath, input)
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
        execute: async (input) => lineReplace(projectPath, input)
      })
    }
  } as any);

  let finalText = '';
  let reasoningText = '';
  let finishReason = 'unknown';
  let rawFinishReason = '';
  const toolCalls: string[] = [];
  const streamErrors: string[] = [];
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      finalText += part.text;
    } else if (part.type === 'reasoning-delta') {
      reasoningText += part.text;
    } else if (part.type === 'tool-call') {
      toolCalls.push(String(part.toolName));
    } else if (part.type === 'tool-error') {
      streamErrors.push(`Tool failed: ${String(part.toolName)}\n${errorMessage(part.error)}`);
    } else if (part.type === 'error') {
      streamErrors.push(describeProviderError(part.error, loop));
    } else if (part.type === 'finish') {
      finishReason = part.finishReason;
      rawFinishReason = part.rawFinishReason ?? '';
    }
  }
  if (finalText.trim()) {
    await appendLoopEvent(projectPath, instanceId, {
      role: 'assistant',
      kind: 'text',
      content: finalText.trim()
    });
  }
  if (streamErrors.length > 0) {
    await appendLoopEvent(projectPath, instanceId, {
      role: 'system',
      kind: 'error',
      content: streamErrors.join('\n')
    });
  }
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
  await appendLoopEvent(projectPath, instanceId, { role: 'system', kind: 'event', content: `Loop worker started (pid ${process.pid}).` });

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
      const stopDecision = await evaluateStopPolicy(projectPath, instance);
      if (stopDecision) {
        finalStatus = stopDecision.status;
        finalMessage = stopDecision.message;
        break;
      }
      if (instance.status !== 'running' && instance.status !== 'waiting_for_human') {
        await markInstanceStatus(projectPath, instanceId, 'running');
      }
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
