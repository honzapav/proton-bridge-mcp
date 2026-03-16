#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createCredentialProvider } from './credentials/provider.js';
import { ImapPool } from './connection/imap-pool.js';
import { MessageService } from './services/message.service.js';
import { MailboxService } from './services/mailbox.service.js';
import { OrganizeService } from './services/organize.service.js';
import { DraftService } from './services/draft.service.js';
import { SendService } from './services/send.service.js';
import { registerReadingTools } from './tools/reading.js';
import { registerComposingTools } from './tools/composing.js';
import { registerSendingTools } from './tools/sending.js';
import { registerOrganizingTools } from './tools/organizing.js';
import { registerMailboxTools } from './tools/mailbox.js';
import { registerConnectionTools } from './tools/connection.js';

async function main() {
  const config = loadConfig();
  const credentialProvider = createCredentialProvider(config);
  const credentials = await credentialProvider.getCredentials();

  const pool = new ImapPool({
    host: config.imap.host,
    port: config.imap.port,
    auth: { user: credentials.username, pass: credentials.password },
    poolSize: config.imap.poolSize,
    acquireTimeout: config.imap.acquireTimeout,
    commandTimeout: config.imap.commandTimeout,
    idleTimeout: config.imap.idleTimeout,
  });

  const messageService = new MessageService(pool);
  const mailboxService = new MailboxService(pool);
  const organizeService = new OrganizeService(pool);
  const draftService = new DraftService(pool, messageService);
  const sendService = new SendService(
    {
      host: config.smtp.host,
      port: config.smtp.port,
      auth: { user: credentials.username, pass: credentials.password },
    },
    messageService,
  );

  const server = new McpServer({ name: 'proton-bridge-mcp', version: '0.1.0' });

  registerReadingTools(server, messageService);
  registerComposingTools(server, draftService);
  registerSendingTools(server, sendService);
  registerOrganizingTools(server, organizeService);
  registerMailboxTools(server, mailboxService);
  registerConnectionTools(server, pool);

  const shutdown = async () => { await pool.shutdown(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start proton-bridge-mcp:', err.message);
  process.exit(1);
});
