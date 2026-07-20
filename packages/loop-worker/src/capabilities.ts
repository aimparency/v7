export type LoopCapability = 'coding' | 'experiments' | 'code-intelligence';

export const capabilityToolNames: Record<LoopCapability, string[]> = {
  coding: [
    'list_files', 'search_files', 'read_file', 'git_status', 'git_diff',
    'run_command', 'propose_patch', 'apply_patch', 'str_replace', 'line_replace'
  ],
  experiments: ['experiment'],
  'code-intelligence': ['code_intelligence']
};

export function filterToolsByCapabilities<T>(
  tools: Record<string, T>,
  capabilities: LoopCapability[]
): Record<string, T> {
  const enabled = new Set(capabilities);
  return Object.fromEntries(Object.entries(tools).filter(([toolName]) => (
    !Object.entries(capabilityToolNames).some(
      ([capability, toolNames]) => !enabled.has(capability as LoopCapability) && toolNames.includes(toolName)
    )
  )));
}
