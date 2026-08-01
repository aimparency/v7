const FORBIDDEN_STANDALONE_ARGUMENTS = new Set([
  '--dangerously-skip-permissions',
  '--dangerously-bypass-approvals-and-sandbox',
  '--yolo',
  '--ask-for-approval=never',
  '--approval-policy=never',
  '--approval-mode=yolo',
]);

const FORBIDDEN_ARGUMENT_VALUES = new Map([
  ['--ask-for-approval', new Set(['never'])],
  ['--approval-policy', new Set(['never'])],
  ['--approval-mode', new Set(['yolo'])],
]);

export type AgentProcessRole = 'worker' | 'watchdog';

/**
 * Fail closed before process creation when a profile requests a CLI mode that
 * suppresses the human permission boundary. Profiles may still select bounded
 * modes (for example Gemini auto_edit), but cannot silently opt out of approval.
 */
export function assertNoPermissionBypass(
  args: readonly string[],
  role: AgentProcessRole,
): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (FORBIDDEN_STANDALONE_ARGUMENTS.has(argument)) {
      throw new Error(`Refusing to start ${role}: forbidden permission-bypass argument ${argument}`);
    }

    const forbiddenValues = FORBIDDEN_ARGUMENT_VALUES.get(argument);
    const value = args[index + 1]?.toLowerCase();
    if (forbiddenValues && value && forbiddenValues.has(value)) {
      throw new Error(
        `Refusing to start ${role}: forbidden permission-bypass arguments ${argument} ${args[index + 1]}`,
      );
    }
  }
}
