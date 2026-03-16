import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SendService } from '../services/send.service.js';
import { errorToToolResponse } from '../errors.js';

export function registerSendingTools(server: McpServer, sendService: SendService): void {
  server.tool(
    'send_reply',
    'Send a reply to an existing email via SMTP. Threading is handled automatically (In-Reply-To, References, subject prefix, reply-to address). The reply is sent immediately, not saved as a draft.',
    {
      folder: z.string().describe('Folder containing the original email (e.g. "INBOX").'),
      uid: z.number().int().describe('UID of the email being replied to.'),
      body: z.string().describe('Plain text body of the reply.'),
      html: z.string().optional(),
      from: z.string().optional(),
      cc: z.array(z.string()).optional(),
      bcc: z.array(z.string()).optional(),
    },
    async ({ folder, uid, body, html, from, cc, bcc }): Promise<CallToolResult> => {
      try {
        await sendService.sendReply(folder, uid, body, { html, from, cc, bcc });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'send_reply') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'send_email',
    'Send a new email via SMTP. The email is sent immediately, not saved as a draft.',
    {
      to: z.array(z.string()),
      subject: z.string(),
      body: z.string(),
      html: z.string().optional(),
      from: z.string().optional(),
      cc: z.array(z.string()).optional(),
      bcc: z.array(z.string()).optional(),
    },
    async ({ to, subject, body, html, from, cc, bcc }): Promise<CallToolResult> => {
      try {
        await sendService.send(to, subject, body, { html, from, cc, bcc });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'send_email') as unknown as CallToolResult;
      }
    },
  );
}
