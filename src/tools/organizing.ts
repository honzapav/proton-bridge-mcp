import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OrganizeService } from '../services/organize.service.js';
import { errorToToolResponse } from '../errors.js';

export function registerOrganizingTools(server: McpServer, organizeService: OrganizeService): void {
  server.tool(
    'move_emails',
    'Move emails to another folder.',
    {
      folder: z.string(),
      uids: z.array(z.number().int()),
      destination: z.string(),
    },
    async ({ folder, uids, destination }): Promise<CallToolResult> => {
      try {
        await organizeService.moveEmails(folder, uids, destination);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'move_emails') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'mark_as_read',
    'Mark emails as read.',
    {
      folder: z.string(),
      uids: z.array(z.number().int()),
    },
    async ({ folder, uids }): Promise<CallToolResult> => {
      try {
        await organizeService.markAsRead(folder, uids);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'mark_as_read') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'mark_as_unread',
    'Mark emails as unread.',
    {
      folder: z.string(),
      uids: z.array(z.number().int()),
    },
    async ({ folder, uids }): Promise<CallToolResult> => {
      try {
        await organizeService.markAsUnread(folder, uids);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'mark_as_unread') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'star_email',
    'Star (flag) emails.',
    {
      folder: z.string(),
      uids: z.array(z.number().int()),
    },
    async ({ folder, uids }): Promise<CallToolResult> => {
      try {
        await organizeService.starEmail(folder, uids);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'star_email') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'unstar_email',
    'Remove star (flag) from emails.',
    {
      folder: z.string(),
      uids: z.array(z.number().int()),
    },
    async ({ folder, uids }): Promise<CallToolResult> => {
      try {
        await organizeService.unstarEmail(folder, uids);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'unstar_email') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'apply_labels',
    'Apply labels to emails.',
    {
      folder: z.string(),
      uids: z.array(z.number().int()),
      labels: z.array(z.string()),
    },
    async ({ folder, uids, labels }): Promise<CallToolResult> => {
      try {
        await organizeService.applyLabels(folder, uids, labels);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'apply_labels') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'remove_labels',
    'Remove labels from emails.',
    {
      folder: z.string(),
      uids: z.array(z.number().int()),
      labels: z.array(z.string()),
    },
    async ({ folder, uids, labels }): Promise<CallToolResult> => {
      try {
        await organizeService.removeLabels(folder, uids, labels);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'remove_labels') as unknown as CallToolResult;
      }
    },
  );
}
