import { createTRPCProxyClient, createWSClient, wsLink, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from 'backend';
import { backendWsUrl } from './utils/runtime-config';
import { loginToken } from './utils/login';
import { clientId, mutationActivity } from './utils/mutation-activity';
import { readOnlyGuardLink } from './utils/read-only';
import { connectionCallbacks, reconnectDelayMs } from './utils/backend-connection';

const mutationTrackingLink: TRPCLink<AppRouter> = () => ({ next, op }) => {
  if (op.type !== 'mutation') return next(op);
  return observable((observer) => {
    mutationActivity.onStart(op.path);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      mutationActivity.onEnd(op.path);
    };
    const subscription = next(op).subscribe({
      next: (value) => observer.next(value),
      error: (error) => { end(); observer.error(error); },
      complete: () => { end(); observer.complete(); }
    });
    return () => { end(); subscription.unsubscribe(); };
  });
};

// Create WebSocket client
const wsClient = createWSClient({
  url: backendWsUrl(),
  connectionParams: { clientId, token: loginToken() ?? undefined },
  // The dev backend restarts on every source change (tsx watch) and requests
  // queue until the socket is back: tRPC's default backoff (2, 4, 8, 16 s…)
  // turned a ~1 s restart into seconds of a dead UI. Retry quickly instead.
  retryDelayMs: reconnectDelayMs,
  ...connectionCallbacks(),
});

// Create tRPC client with WebSocket
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    readOnlyGuardLink,
    mutationTrackingLink,
    wsLink({
      client: wsClient,
    }),
  ],
});
