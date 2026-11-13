import type { Response } from "express";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidTokenError, UnsupportedGrantTypeError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { BackendClient } from "./client.js";

// An MCP client's own login (OAuth 2.1 with PKCE, as the MCP specification
// asks): the SDK's router speaks the protocol, this provider hands each step
// to the backend, where the clients, the waiting requests and the codes live
// (backend auth/mcp-clients.ts). The person approves on the server's own page
// (<public URL>/?mcp-authorize=<request>), choosing the graphs; the token the
// client ends up with is an ordinary login token limited to those.

// The SDK's check wants an end time; these tokens have none and are looked up
// on every request, so each lookup vouches for a short while.
const VOUCHED_SECONDS = 600;

/** `tokenInfo(token)`: who the token logs in, asked from the backend; null when it is no login. */
export function createOAuthProvider(
  backend: BackendClient,
  publicUrl: string,
  tokenInfo: (token: string) => Promise<{ account: string } | null>,
): OAuthServerProvider {
  // What the backend refuses (an unknown or used code, a client it does not know) is the client's to hear.
  const grant = async <T>(step: Promise<T>): Promise<T> => {
    try {
      return await step;
    } catch (error) {
      throw new InvalidGrantError(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    clientsStore: {
      getClient: async (clientId) =>
        (await backend.mcpAuth.getClient.query({ clientId }) ?? undefined) as OAuthClientInformationFull | undefined,
      registerClient: async (client) =>
        await backend.mcpAuth.registerClient.mutate({ client: client as OAuthClientInformationFull }) as OAuthClientInformationFull,
    },

    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
      const { requestId } = await grant(backend.mcpAuth.begin.mutate({
        clientId: client.client_id, redirectUri: params.redirectUri, codeChallenge: params.codeChallenge, state: params.state,
      }));
      const page = new URL(publicUrl);
      page.searchParams.set("mcp-authorize", requestId);
      res.redirect(page.href);
    },

    async challengeForAuthorizationCode(client, authorizationCode) {
      return (await grant(backend.mcpAuth.challenge.query({ clientId: client.client_id, code: authorizationCode }))).codeChallenge;
    },

    async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri): Promise<OAuthTokens> {
      const { token } = await grant(backend.mcpAuth.exchange.mutate({ clientId: client.client_id, code: authorizationCode, redirectUri }));
      return { access_token: token, token_type: "Bearer" };
    },

    // Tokens do not expire; the person revokes them in the UI.
    async exchangeRefreshToken(): Promise<OAuthTokens> {
      throw new UnsupportedGrantTypeError("This server issues no refresh tokens: its tokens do not expire.");
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const info = await tokenInfo(token);
      if (!info) throw new InvalidTokenError("This token is no login on this server.");
      return { token, clientId: info.account, scopes: [], expiresAt: Math.floor(Date.now() / 1000) + VOUCHED_SECONDS };
    },
  };
}
