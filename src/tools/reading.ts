import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MessageService } from '../services/message.service.js';
import { errorToToolResponse } from '../errors.js';

export function registerReadingTools(server: McpServer, messageService: MessageService): void {
  server.tool(
    'list_emails',
    'List emails from a folder with pagination. Returns metadata only (subject, sender, date, flags).',
    {
      folder: z.string().default('INBOX'),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    },
    async ({ folder, limit, offset }): Promise<CallToolResult> => {
      try {
        const result = await messageService.listEmails(folder, limit, offset);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return errorToToolResponse(err, 'list_emails') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'get_email',
    'Get a full email by UID including body content.',
    {
      folder: z.string(),
      uid: z.number().int(),
      include_attachments: z.boolean().default(false),
    },
    async ({ folder, uid, include_attachments }): Promise<CallToolResult> => {
      try {
        const result = await messageService.getEmail(folder, uid, include_attachments);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return errorToToolResponse(err, 'get_email') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'get_email_headers',
    'Get email headers only. Lightweight alternative to get_email.',
    {
      folder: z.string(),
      uid: z.number().int(),
    },
    async ({ folder, uid }): Promise<CallToolResult> => {
      try {
        const result = await messageService.getEmailHeaders(folder, uid);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return errorToToolResponse(err, 'get_email_headers') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'search_emails',
    'Search emails with criteria. Returns metadata for matching emails.',
    {
      folder: z.string().default('INBOX'),
      from: z.string().optional(),
      to: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      since: z.string().optional(),
      before: z.string().optional(),
      has_attachment: z.boolean().optional(),
      is_unread: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    },
    async ({ folder, from, to, subject, body, since, before, has_attachment, is_unread, limit, offset }): Promise<CallToolResult> => {
      try {
        const criteria = {
          from,
          to,
          subject,
          body,
          since,
          before,
          hasAttachment: has_attachment,
          isUnread: is_unread,
        };
        const result = await messageService.searchEmails(folder, criteria, limit, offset);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return errorToToolResponse(err, 'search_emails') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'get_unread_count',
    'Get unread email count for a folder.',
    {
      folder: z.string().default('INBOX'),
    },
    async ({ folder }): Promise<CallToolResult> => {
      try {
        const unread = await messageService.getUnreadCount(folder);
        return { content: [{ type: 'text', text: JSON.stringify({ folder, unread }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'get_unread_count') as unknown as CallToolResult;
      }
    },
  );
}
