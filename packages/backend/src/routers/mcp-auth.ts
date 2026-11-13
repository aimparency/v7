import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { hasAccounts } from 'shared/server-config';
import { t, delayedProcedure } from '../trpc.js';
import { issueToken, resolveToken } from '../auth/accounts.js';
import * as clients from '../auth/mcp-clients.js';
import { findGraph } from '../graphs/registry.js';

// The steps of an MCP client's own login (auth/mcp-clients.ts). Most are open
// by nature: they are the protocol, called by the MCP server for whatever
// client knocks; what protects a login is the person's approval in the UI, the
// one-time code and the client's PKCE proof. Only `approve` needs an account.
async function run<T>(action: () => T | Promise<T>): Promise<T> {
  if (!hasAccounts()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This server has no accounts.' });
  try {
    return await action();
  } catch (error) {
    if (error instanceof clients.McpAuthError) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    throw error;
  }
}

const client = z.looseObject({
  client_id: z.string().min(1).max(200),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().url().max(2000)).min(1).max(10)
});

export const mcpAuthRouter = t.router({
  registerClient: delayedProcedure
    .input(z.object({ client }))
    .mutation(({ input }) => run(() => clients.registerClient(input.client))),

  getClient: delayedProcedure
    .input(z.object({ clientId: z.string().max(200) }))
    .query(({ input }) => clients.findClient(input.clientId)),

  begin: delayedProcedure
    .input(z.object({
      clientId: z.string().max(200),
      redirectUri: z.string().url().max(2000),
      codeChallenge: z.string().min(1).max(200),
      state: z.string().max(2000).optional()
    }))
    .mutation(({ input }) => run(() => ({ requestId: clients.beginRequest(input) }))),

  // What the approval page shows: who asks, and where the login will be sent.
  pending: delayedProcedure
    .input(z.object({ requestId: z.string().max(100) }))
    .query(({ input }) => {
      const request = clients.pendingRequest(input.requestId);
      return request && { clientName: request.client.client_name ?? 'An MCP client', redirectHost: new URL(request.redirectUri).host };
    }),

  // The logged-in person lets the client act as them: everywhere, or on the graphs named.
  approve: delayedProcedure
    .input(z.object({ requestId: z.string().max(100), graphs: z.array(z.string()).max(200).optional() }))
    .mutation(({ ctx, input }) => run(() => {
      const account = ctx.viewer?.name;
      if (!account) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Log in first.' });
      for (const slug of input.graphs ?? []) {
        if (!findGraph(slug)) throw new TRPCError({ code: 'BAD_REQUEST', message: `No graph "${slug}" on this server.` });
      }
      return { redirectTo: clients.approveRequest(input.requestId, account, input.graphs) };
    })),

  deny: delayedProcedure
    .input(z.object({ requestId: z.string().max(100) }))
    .mutation(({ input }) => run(() => ({ redirectTo: clients.denyRequest(input.requestId) }))),

  challenge: delayedProcedure
    .input(z.object({ clientId: z.string().max(200), code: z.string().max(200) }))
    .query(({ input }) => run(() => ({ codeChallenge: clients.codeChallenge(input.clientId, input.code) }))),

  // The code becomes a login token, limited to the graphs the person chose.
  exchange: delayedProcedure
    .input(z.object({ clientId: z.string().max(200), code: z.string().max(200), redirectUri: z.string().max(2000).optional() }))
    .mutation(({ input }) => run(async () => {
      const { account, graphs, clientName } = clients.redeemCode(input.clientId, input.code, input.redirectUri);
      return { token: await issueToken(account, clientName.slice(0, 100), graphs) };
    })),

  // Whether the caller's token is a login at all (one limited to graphs is nobody to auth.me).
  tokenInfo: delayedProcedure.query(({ ctx }) => {
    const account = resolveToken(ctx.session?.token);
    return account && { account: account.name, graphs: account.scope };
  })
});
