import { createTRPCProxyClient, createWSClient, wsLink, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from 'backend';
import { buildWsUrl, getRuntimeConfig } from './utils/runtime-config';
import { clientId, mutationActivity } from './utils/mutation-activity';

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
  url: buildWsUrl(getRuntimeConfig().backendWsPort),
  connectionParams: { clientId },
});

// Create tRPC client with WebSocket
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    mutationTrackingLink,
    wsLink({
      client: wsClient,
    }),
  ],
});
