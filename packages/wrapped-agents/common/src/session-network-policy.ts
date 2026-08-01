export const DEFAULT_SESSION_BIND_HOST = '127.0.0.1';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

export function resolveSessionBindHost(configuredHost: string | undefined): string {
  const trimmed = configuredHost?.trim();
  return trimmed || DEFAULT_SESSION_BIND_HOST;
}

/**
 * Browser-origin boundary for the session's control API and Socket.IO surface.
 * Every control client must present a browser origin that is loopback or
 * matches the operator's explicit BIND_HOST exactly.
 */
export function isAllowedSessionOrigin(
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
