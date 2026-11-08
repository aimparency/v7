import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { LoopDefinition, LoopRole, LoopRoleModel } from 'agent-tools';

// Per-role models: each stage role runs on its configured model, or on the
// loop's own model when the role is not configured.

export type RoleModelSpec = Required<LoopRoleModel>;

const API_KEY_NAMES: Record<LoopRoleModel['provider'], string> = {
  nvidia: 'NVIDIA_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'openai-compatible': 'LOOP_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY'
};

const DEFAULT_BASE_URLS: Partial<Record<LoopRoleModel['provider'], string>> = {
  nvidia: 'https://integrate.api.nvidia.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  anthropic: 'https://api.anthropic.com/v1'
};

export function apiKeyName(provider: LoopRoleModel['provider']): string {
  return API_KEY_NAMES[provider];
}

export function roleModelSpec(loop: LoopDefinition, role: LoopRole): RoleModelSpec {
  const configured = loop.roles?.[role];
  if (!configured) return { provider: loop.provider, model: loop.model, baseUrl: loop.baseUrl };
  const baseUrl = configured.baseUrl ?? DEFAULT_BASE_URLS[configured.provider];
  if (!baseUrl) throw new Error(`Role ${role} uses provider ${configured.provider}, which needs a baseUrl.`);
  return { ...configured, baseUrl };
}

export type RoleModels = Record<LoopRole, { spec: RoleModelSpec; model: LanguageModel }>;

/** Resolves every role's model; fails before the cycle starts if a key is missing. */
export function createRoleModels(loop: LoopDefinition, secrets: Record<string, string | undefined>): RoleModels {
  const roles: LoopRole[] = ['planner', 'executor', 'verifier', 'reflector'];
  return Object.fromEntries(roles.map((role) => {
    const spec = roleModelSpec(loop, role);
    const apiKey = secrets[apiKeyName(spec.provider)];
    if (!apiKey) throw new Error(`Missing ${apiKeyName(spec.provider)} for the ${role} role (${spec.provider} / ${spec.model}) in .bowman/secrets.json.`);
    const model = spec.provider === 'anthropic'
      ? createAnthropic({ apiKey, baseURL: spec.baseUrl })(spec.model)
      : createOpenAICompatible({ name: spec.provider, baseURL: spec.baseUrl, apiKey })(spec.model);
    return [role, { spec, model }];
  })) as RoleModels;
}
