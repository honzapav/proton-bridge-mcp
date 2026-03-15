import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ImapPool } from '../connection/imap-pool.js';
import { errorToToolResponse } from '../errors.js';

export function registerConnectionTools(server: McpServer, pool: ImapPool): void {
  server.tool(
    'get_connection_status',
    'Get the current IMAP connection pool status.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const stats = pool.getStats();
        const connected = pool.isConnected();
        const result = {
          imap: {
            connected,
            pool: stats,
          },
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return errorToToolResponse(err, 'get_connection_status') as unknown as CallToolResult;
      }
    },
  );
}
