import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MailboxService } from '../services/mailbox.service.js';
import { errorToToolResponse } from '../errors.js';

export function registerMailboxTools(server: McpServer, mailboxService: MailboxService): void {
  server.tool(
    'list_folders',
    'List all folders in the mailbox.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const result = await mailboxService.listFolders();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return errorToToolResponse(err, 'list_folders') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'create_folder',
    'Create a new folder.',
    {
      name: z.string(),
      parent: z.string().optional(),
    },
    async ({ name, parent }): Promise<CallToolResult> => {
      try {
        await mailboxService.createFolder(name, parent);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'create_folder') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'rename_folder',
    'Rename an existing folder.',
    {
      old_name: z.string(),
      new_name: z.string(),
    },
    async ({ old_name, new_name }): Promise<CallToolResult> => {
      try {
        await mailboxService.renameFolder(old_name, new_name);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'rename_folder') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'list_labels',
    'List all labels in the mailbox.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const result = await mailboxService.listLabels();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return errorToToolResponse(err, 'list_labels') as unknown as CallToolResult;
      }
    },
  );

  server.tool(
    'create_label',
    'Create a new label.',
    {
      name: z.string(),
    },
    async ({ name }): Promise<CallToolResult> => {
      try {
        await mailboxService.createLabel(name);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'create_label') as unknown as CallToolResult;
      }
    },
  );
}
