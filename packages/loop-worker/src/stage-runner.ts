import { hasToolCall, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage } from 'ai';
import type { z } from 'zod';
import { appendLoopEvent, setLoopActivity } from 'agent-tools';
import { apiKeyName, type RoleModelSpec } from './models.js';
import { throwIfStreamFailed } from './runtime-policy.js';
import { errorMessage } from './worker-state.js';

export type StageUsage = { inputTokens: number; outputTokens: number };

export type StageRun<T> = { result: T | null; text: string; usage: StageUsage };

type StageSpec<T> = {
  stage: string;
  model: LanguageModel;
  /** Which provider and model `model` is, for the log and error hints. */
  modelSpec: RoleModelSpec;
  system: string;
  prompt: string;
  tools: Record<string, any>;
  /** The stage ends when the model calls this tool; its validated input is the stage result. */
  submit: { name: string; description: string; schema: z.ZodType<T> };
  maxSteps: number;
  projectPath: string;
  instanceId: string;
  signal: AbortSignal;
};

/**
 * Runs one model stage: a tool loop that ends in a submit tool call. Tool
 * calling works on every provider the loop supports, unlike JSON-schema
 * response formats. If the model stops without submitting, it gets one more
 * turn with only the submit tool.
 */
export async function runStage<T>(spec: StageSpec<T>): Promise<StageRun<T>> {
  let result: T | null = null;
  const submitTool = tool({
    description: spec.submit.description,
    inputSchema: spec.submit.schema as any,
    execute: async (input: unknown) => {
      result = input as T;
      return { ok: true };
    }
  });
  await appendLoopEvent(spec.projectPath, spec.instanceId, {
    role: 'system',
    kind: 'event',
    content: [
      `Stage ${spec.stage}: request to ${spec.modelSpec.provider} / ${spec.modelSpec.model}`,
      '',
      '[system]',
      spec.system,
      '',
      '[prompt]',
      spec.prompt
    ].join('\n')
  });

  const first = await streamToLog(spec, {
    system: spec.system,
    prompt: spec.prompt,
    tools: { ...spec.tools, [spec.submit.name]: submitTool },
    stopWhen: [stepCountIs(spec.maxSteps), hasToolCall(spec.submit.name)]
  });
  if (result !== null || spec.signal.aborted) return { result, text: first.text, usage: first.usage };

  const messages: ModelMessage[] = [
    { role: 'user', content: spec.prompt },
    ...first.messages,
    { role: 'user', content: `Stop working now and submit your result with ${spec.submit.name}.` }
  ];
  const retry = await streamToLog(spec, {
    system: spec.system,
    messages,
    tools: { [spec.submit.name]: submitTool },
    toolChoice: 'required',
    stopWhen: stepCountIs(1)
  });
  return {
    result,
    text: `${first.text}${retry.text}`,
    usage: {
      inputTokens: first.usage.inputTokens + retry.usage.inputTokens,
      outputTokens: first.usage.outputTokens + retry.usage.outputTokens
    }
  };
}

async function streamToLog(spec: StageSpec<unknown>, call: Record<string, unknown>) {
  const { projectPath, instanceId } = spec;
  const stream = streamText({ model: spec.model, abortSignal: spec.signal, ...call } as any);

  let text = '';
  let flushedLength = 0;
  let lastFlushAt = Date.now();
  let sawPart = false;
  const errors: string[] = [];
  const flushText = async (force: boolean) => {
    const pending = text.slice(flushedLength);
    if (!pending.trim()) return;
    const due = Date.now() - lastFlushAt >= 1000 || pending.length >= 80 || /[.!?]\s$/.test(pending);
    if (!force && !due) return;
    flushedLength = text.length;
    lastFlushAt = Date.now();
    await appendLoopEvent(projectPath, instanceId, { role: 'assistant', kind: 'text', content: pending });
  };

  await setLoopActivity(projectPath, instanceId, `${spec.stage}: waiting for ${spec.modelSpec.provider} / ${spec.modelSpec.model}`);
  for await (const part of stream.fullStream) {
    if (!sawPart) {
      sawPart = true;
      await setLoopActivity(projectPath, instanceId, `${spec.stage}: streaming`);
    }
    if (part.type === 'text-delta') {
      text += part.text;
      await flushText(false);
    } else if (part.type === 'tool-call') {
      await flushText(true);
      await setLoopActivity(projectPath, instanceId, `${spec.stage}: ${String(part.toolName)}`);
      await appendLoopEvent(projectPath, instanceId, {
        role: 'system',
        kind: 'event',
        content: `Calling tool: ${String(part.toolName)}\n${truncate(part.input)}`
      });
    } else if (part.type === 'tool-result') {
      await appendLoopEvent(projectPath, instanceId, {
        role: 'system',
        kind: 'event',
        content: `Tool result: ${String(part.toolName)}\n${truncate(part.output)}`
      });
    } else if (part.type === 'tool-error') {
      // The model sees the failure as the tool result and can correct itself (e.g. an invalid submit).
      await appendLoopEvent(projectPath, instanceId, {
        role: 'system',
        kind: 'error',
        content: `Tool failed: ${String(part.toolName)}\n${errorMessage(part.error)}`
      });
    } else if (part.type === 'error') {
      errors.push(describeProviderError(part.error, spec.modelSpec));
    }
  }
  await flushText(true);
  if (errors.length > 0) {
    await appendLoopEvent(projectPath, instanceId, { role: 'system', kind: 'error', content: errors.join('\n') });
  }
  throwIfStreamFailed(errors);
  const [response, usage] = await Promise.all([stream.response, stream.totalUsage]);
  return {
    text,
    messages: response.messages as ModelMessage[],
    usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 }
  };
}

function truncate(output: unknown): string {
  const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  return text.length > 1200 ? `${text.slice(0, 1200)}\n...[truncated ${text.length - 1200} chars]` : text;
}

export function describeProviderError(error: unknown, loop: RoleModelSpec): string {
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
    lines.push(`likely cause: ${apiKeyName(loop.provider)} is missing, invalid, expired, or not accepted by this endpoint/model.`);
    lines.push('Check the loop configuration and .bowman/secrets.json for this project.');
  }
  return lines.join('\n');
}
