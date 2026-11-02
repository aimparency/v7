// Network boundary of the local servers (backend, broker, agent sessions).
// They can run code on this machine, so they listen on loopback unless the
// operator names an interface (BIND_HOST, set by `pnpm dev:host`), and they
// answer only browser pages served from loopback or that named host: any
// other website the user has open could otherwise drive them.

export const DEFAULT_BIND_HOST = '127.0.0.1';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

export function resolveBindHost(configuredHost: string | undefined): string {
  return configuredHost?.trim() || DEFAULT_BIND_HOST;
}

/** A browser origin served from loopback or exactly the configured host. */
export function isAllowedBrowserOrigin(
  origin: string | undefined,
  configuredHost: string | undefined,
): boolean {
  if (origin === undefined) return false;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const originHost = normalizeHostname(url.hostname);
  if (LOOPBACK_HOSTS.has(originHost)) return true;

  const explicitHost = configuredHost?.trim();
  return explicitHost !== undefined && originHost === normalizeHostname(explicitHost);
}

/**
 * For servers that also serve local programs (MCP, loop worker, scripts):
 * those send no Origin header and already run on this machine, so only a
 * present Origin, i.e. a browser page, is checked.
 */
export function isAllowedClientOrigin(
  origin: string | undefined,
  configuredHost: string | undefined,
): boolean {
  return origin === undefined || isAllowedBrowserOrigin(origin, configuredHost);
}
