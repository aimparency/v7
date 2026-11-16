import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import type { AppRouter } from 'backend';
import { backendWsUrl } from './utils/runtime-config';
import { loginToken } from './utils/login';
import { clientId } from './utils/mutation-activity';
import { mutationTrackingLink } from './utils/mutation-tracking-link';
import { readOnlyGuardLink } from './utils/read-only';
import { ideaSpaceLink } from './utils/idea-spaces';
import { connectionCallbacks, reconnectDelayMs } from './utils/backend-connection';

// Create WebSocket client
const wsClient = createWSClient({
  url: backendWsUrl(),
  // Read at every (re)connection: the login may have changed since the last one.
  connectionParams: () => ({ clientId, token: loginToken() ?? undefined }),
  // The dev backend restarts on every source change (tsx watch) and requests
  // queue until the socket is back: tRPC's default backoff (2, 4, 8, 16 s…)
  // turned a ~1 s restart into seconds of a dead UI. Retry quickly instead.
  retryDelayMs: reconnectDelayMs,
  ...connectionCallbacks(),
});

// Create tRPC client with WebSocket
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    // First: a request about an idea of a space opened in place goes to that
    // space, on this server or on its own.
    ideaSpaceLink,
    readOnlyGuardLink,
    mutationTrackingLink,
    wsLink({
      client: wsClient,
    }),
  ],
});
