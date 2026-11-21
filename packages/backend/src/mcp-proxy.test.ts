// The one-port server passes /mcp on to the MCP server. An MCP session lasts
// as long as its event stream, so a client that leaves must end it there too.
import { test } from 'vitest';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { proxy } from './server';

const listen = async (server: http.Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

test('a client leaving an event stream closes it at the MCP server', async () => {
  let streamClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => { streamClosed = resolve; });
  const mcp = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: endpoint\ndata: /messages?sessionId=1\n\n');
    res.on('close', () => streamClosed());
  });
  const mcpPort = await listen(mcp);
  const front = http.createServer((req, res) => proxy(req, res, mcpPort));
  const frontPort = await listen(front);

  try {
    const client = http.get({ host: '127.0.0.1', port: frontPort, path: '/mcp/sse' });
    const response = await new Promise<http.IncomingMessage>((resolve) => client.once('response', resolve));
    await new Promise((resolve) => response.once('data', resolve));
    client.destroy();

    const outcome = await Promise.race([closed.then(() => 'closed'), new Promise((resolve) => setTimeout(() => resolve('still open'), 2000))]);
    assert.equal(outcome, 'closed');
  } finally {
    front.closeAllConnections();
    mcp.closeAllConnections();
    front.close();
    mcp.close();
  }
});
