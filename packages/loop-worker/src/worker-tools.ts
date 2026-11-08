import { jsonSchema, tool } from 'ai';
import {
  appendLoopEvent,
  applyUnifiedPatch,
  buildCodeIndex,
  changeImpact,
  codeHeatmap,
  createExperiment,
  gitDiff,
  gitStatus,
  ideaHistorySearch,
  lineReplace,
  listExperiments,
  listFiles,
  patchWorkerState,
  proposePatch,
  readFileRange,
  runCommand,
  searchFiles,
  semanticCodeSearch,
  strReplace,
  symbolContext,
  updateExperiment,
  type GraphTools
} from 'agent-tools';
import { graphCatalogTools } from './graph-catalog-tools.js';
import { markInstanceStatus, waitForHumanAnswer } from './worker-state.js';

export type WorkerToolContext = {
  projectPath: string;
  instanceId: string;
  /** Where coding tools act: the loop's worktree, or the project. */
  executionPath: string;
  graph: GraphTools;
  signal: AbortSignal;
};

/** Every tool a stage can be given; stages pick their subset by name (see STAGE_TOOL_NAMES). */
export function buildWorkerTools({ projectPath, instanceId, executionPath, graph, signal }: WorkerToolContext): Record<string, any> {
  return {
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
    ...graphCatalogTools(graph, projectPath),
    experiment: tool({
      description: 'Create, list, or update durable experiments. Define predictions and stop conditions before acting; append evidence and belief updates after observing results.',
      inputSchema: jsonSchema<{
        action: 'create' | 'list' | 'update';
        experimentId?: string;
        ideaIds?: string[];
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
          ideaIds: { type: 'array', items: { type: 'string' } },
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
            ideaIds: input.ideaIds,
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
      description: 'Inspect code and its idea history through one compact interface: index builds local code embeddings; semantic searches by meaning; heatmap combines lexical matches and churn; symbol finds definitions/references; impact finds dependents/tests; idea-history retrieves prior intent, status comments, connection hypotheses and reflections, and realized commits.',
      inputSchema: jsonSchema<{
        mode: 'index' | 'semantic' | 'heatmap' | 'symbol' | 'impact' | 'idea-history';
        query?: string;
        limit?: number;
        maxFiles?: number;
        maxChunks?: number;
      }>({
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['index', 'semantic', 'heatmap', 'symbol', 'impact', 'idea-history'] },
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
        if (mode === 'idea-history') return ideaHistorySearch(executionPath, query, limit);
        return changeImpact(executionPath, query, limit);
      }
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
}
