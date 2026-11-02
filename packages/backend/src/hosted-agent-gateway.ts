import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { resolveToken } from './auth/accounts.js';

// On a hosted instance the wrapped agents are a shell on the server, so only
// admins reach them (Felix 2026-11-02). The broker and the agent sessions
// listen on 127.0.0.1; this gateway on the one public port is the only way in:
//   /broker              the broker's tRPC WebSocket
//   /session/<port>/...  one agent session (Socket.IO, polling and WebSocket)
// Each request needs the admin's login in an HttpOnly, SameSite=Strict cookie
// (browser WebSockets send no headers, and a token in the URL would land in
// nginx's logs). The token is resolved on every request, so a logout or a
// demotion ends access to new connections at once.

export const AGENT_COOKIE = 'aimparency-agent';
const SESSION_PORT_RANGE = 100;

export type AgentRoute = { port: number; path: string };

export function agentRoute(
  url: string,
  ports: { brokerWs: number; processStart: number },
): AgentRoute | null {
  const broker = /^\/broker(\/.*)?$/.exec(url.split('?')[0]!);
  if (broker) {
    const rest = url.slice('/broker'.length);
    return { port: ports.brokerWs, path: rest.startsWith('/') ? rest : `/${rest}` };
  }
  const session = /^\/session\/(\d{1,5})(\/.*)?$/.exec(url);
  if (!session) return null;
  const port = Number(session[1]);
  if (port < ports.processStart || port >= ports.processStart + SESSION_PORT_RANGE) return null;
  return { port, path: session[2] || '/' };
}

export function cookieToken(header: string | undefined): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [name, ...value] = part.trim().split('=');
    if (name === AGENT_COOKIE) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

// A present Origin must be this page's own host; the cookie's SameSite=Strict
// already keeps other sites out, this is the second lock.
function sameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export async function isAdminRequest(req: http.IncomingMessage, project: string): Promise<boolean> {
  if (!sameOrigin(req)) return false;
  const user = await resolveToken(project, cookieToken(req.headers.cookie));
  return user?.role === 'admin';
}

/** POST with `Authorization: Bearer <token>`: an admin's token becomes the agent cookie. */
export async function issueAgentCookie(req: http.IncomingMessage, res: http.ServerResponse, project: string) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const user = req.method === 'POST' && sameOrigin(req) ? await resolveToken(project, token) : null;
  if (user?.role !== 'admin') {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('Agents are for admins.');
  }
  const secure = req.headers['x-forwarded-proto'] === 'https' || (req.socket as { encrypted?: boolean }).encrypted;
  res.writeHead(204, {
    'set-cookie': `${AGENT_COOKIE}=${encodeURIComponent(token!)}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`,
    'cache-control': 'no-store',
  });
  res.end();
}

// The upstream sees a loopback client: its own origin check passes, and the
// login cookie stays at the gateway.
function upstreamHeaders(req: http.IncomingMessage, port: number): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers.cookie;
  if (headers.origin !== undefined) headers.origin = `http://127.0.0.1:${port}`;
  return headers;
}

export function proxyAgentRequest(req: http.IncomingMessage, res: http.ServerResponse, route: AgentRoute) {
  const upstream = http.request(
    { host: '127.0.0.1', port: route.port, path: route.path, method: req.method, headers: upstreamHeaders(req, route.port) },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('The agent is not running.');
  });
  req.pipe(upstream);
}

export function proxyAgentUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, route: AgentRoute) {
  const upstream = net.connect(route.port, '127.0.0.1', () => {
    const lines = [`${req.method} ${route.path} HTTP/1.1`];
    for (const [name, value] of Object.entries(upstreamHeaders(req, route.port))) {
      for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) lines.push(`${name}: ${item}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
}

export function refuseUpgrade(socket: Duplex, status = '403 Forbidden') {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
