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
    'Save an email as a draft. For replies: first call get_email_headers on the original message to obtain its messageId and references, then set in_reply_to and references so the reply is threaded correctly.',
    {
      to: z.array(z.string()),
      subject: z.string(),
      body: z.string(),
      html: z.string().optional(),
      from: z.string().optional(),
      cc: z.array(z.string()).optional(),
      bcc: z.array(z.string()).optional(),
      in_reply_to: z.string().optional().describe(
        'For replies: the Message-ID of the email being replied to (from get_email_headers). Required for proper threading.',
      ),
      references: z.array(z.string()).optional().describe(
        'For replies: array of Message-IDs forming the thread chain. Take the references from get_email_headers (split by space), append the original messageId. Required for proper threading.',
      ),
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
    'save_reply_draft',
    'Create a reply draft to an existing email. Automatically handles threading (In-Reply-To, References, subject prefix). Use this instead of save_draft when replying to an email.',
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
        await draftService.saveReplyDraft(folder, uid, body, {
          html,
          from: from ? { address: from } : undefined,
          cc: cc?.map((addr) => ({ address: addr })),
          bcc: bcc?.map((addr) => ({ address: addr })),
        });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'save_reply_draft') as unknown as CallToolResult;
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
