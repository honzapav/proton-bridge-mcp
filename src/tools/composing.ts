import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { DraftService } from '../services/draft.service.js';
import { errorToToolResponse } from '../errors.js';

const AttachmentSchema = z.object({
  filename: z.string(),
  content_base64: z.string(),
  content_type: z.string(),
});

export function registerComposingTools(server: McpServer, draftService: DraftService): void {
  server.tool(
    'save_draft',
    'Save an email as a draft.',
    {
      to: z.array(z.string()),
      subject: z.string(),
      body: z.string(),
      html: z.string().optional(),
      from: z.string().optional(),
      cc: z.array(z.string()).optional(),
      bcc: z.array(z.string()).optional(),
      in_reply_to: z.string().optional(),
      references: z.array(z.string()).optional(),
      attachments: z.array(AttachmentSchema).optional(),
    },
    async ({ to, subject, body, html, from, cc, bcc, in_reply_to, references, attachments }): Promise<CallToolResult> => {
      try {
        const input = {
          to: to.map((addr) => ({ address: addr })),
          subject,
          body,
          html,
          from: from ? { address: from } : undefined,
          cc: cc?.map((addr) => ({ address: addr })),
          bcc: bcc?.map((addr) => ({ address: addr })),
          inReplyTo: in_reply_to,
          references: references?.join(' '),
          attachments: attachments?.map((att) => ({
            filename: att.filename,
            contentType: att.content_type,
            content: att.content_base64,
          })),
        };
        await draftService.saveDraft(input);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'save_draft') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'list_drafts',
    'List saved drafts with pagination.',
    {
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    },
    async ({ limit, offset }): Promise<CallToolResult> => {
      try {
        const result = await draftService.listDrafts(limit, offset);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return errorToToolResponse(err, 'list_drafts') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'update_draft',
    'Update an existing draft by UID.',
    {
      uid: z.number().int(),
      to: z.array(z.string()).optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      html: z.string().optional(),
      cc: z.array(z.string()).optional(),
      bcc: z.array(z.string()).optional(),
      attachments: z.array(AttachmentSchema).optional(),
    },
    async ({ uid, to, subject, body, html, cc, bcc, attachments }): Promise<CallToolResult> => {
      try {
        const input = {
          to: (to ?? []).map((addr) => ({ address: addr })),
          subject: subject ?? '',
          body: body ?? '',
          html,
          cc: cc?.map((addr) => ({ address: addr })),
          bcc: bcc?.map((addr) => ({ address: addr })),
          attachments: attachments?.map((att) => ({
            filename: att.filename,
            contentType: att.content_type,
            content: att.content_base64,
          })),
        };
        await draftService.updateDraft(uid, input);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'update_draft') as unknown as CallToolResult;
      }
    },
  );
}
