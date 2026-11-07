import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function fail(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

/**
 * Stateless Streamable HTTP on POST /mcp, a fresh server and transport per
 * request. There is no authentication here: run it only behind an authenticating
 * proxy on a private network.
 */
export function startHttpServer(buildServer: () => McpServer, port: number) {
  const httpServer = createServer(async (req, res) => {
    if (req.url !== '/mcp') return fail(res, 404, 'Not found.');
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed.');
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      const body = await readJson(req);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error('MCP request failed:', err);
      if (!res.headersSent) fail(res, 400, 'Bad request.');
    }
  });
  httpServer.listen(port, () => console.error(`proton-bridge-mcp listening on :${port}`));
  return httpServer;
}
