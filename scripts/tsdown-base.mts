// Shared tsdown setup for the runnable packages (`pnpm start` / release builds).
// Dev never builds: it runs the same sources through tsx.
import { defineConfig, type UserConfig } from 'tsdown';

// Workspace packages ship TypeScript sources, so they are inlined into each
// bundle. Every package dependency stays external and resolves from node_modules at
// runtime, which keeps native modules (node-pty, better-sqlite3, onnxruntime) intact.
// pnpm does not hoist, so a bundle's package must itself declare the
// dependencies of the workspace packages it inlines (see loop-worker, knip.json).
const WORKSPACE_PACKAGES = [/^shared(\/|$)/, 'agent-tools', 'mcp/tool-catalog', '@aimparency/wrapped-agents-common'];

export function nodeBundle(config: UserConfig): UserConfig {
  return defineConfig({
    platform: 'node',
    target: 'node22',
    format: 'esm',
    dts: false,
    clean: true,
    outExtensions: () => ({ js: '.js' }),
    deps: { neverBundle: true, alwaysBundle: WORKSPACE_PACKAGES, onlyBundle: false },
    ...config,
  });
}
