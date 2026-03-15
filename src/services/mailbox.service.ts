import type { ImapPool } from '../connection/imap-pool.js';
import { MailboxError } from '../errors.js';
import type { Folder } from '../types.js';

export const SYSTEM_FOLDERS = new Set([
  'INBOX',
  'Drafts',
  'Sent',
  'Archive',
  'Spam',
  'Trash',
  'Starred',
  'All Mail',
]);

export function classifyFolder(
  path: string,
  specialUse?: string,
): 'system' | 'folder' | 'label' {
  if (specialUse || SYSTEM_FOLDERS.has(path)) {
    return 'system';
  }
  if (path.startsWith('Labels/')) {
    return 'label';
  }
  return 'folder';
}

export class MailboxService {
  private readonly pool: ImapPool;

  constructor(pool: ImapPool) {
    this.pool = pool;
  }

  async listFolders(): Promise<Folder[]> {
    return this.pool.withConnection(async (client) => {
      const mailboxes = await client.list();
      return mailboxes.map((mb) => {
        const flags = mb.flags ? Array.from(mb.flags) : [];
        const specialUse = mb.specialUse ?? undefined;
        return {
          path: mb.path,
          name: mb.name,
          delimiter: mb.delimiter ?? '/',
          specialUse,
          type: classifyFolder(mb.path, specialUse),
          flags,
        } satisfies Folder;
      });
    });
  }

  async listLabels(): Promise<Folder[]> {
    const folders = await this.listFolders();
    return folders.filter((f) => f.type === 'label');
  }

  async createFolder(name: string, parent?: string): Promise<void> {
    const path = parent ? `Folders/${parent}/${name}` : `Folders/${name}`;
    await this.pool.withConnection(async (client) => {
      await client.mailboxCreate(path);
    });
  }

  async renameFolder(oldName: string, newName: string): Promise<void> {
    if (SYSTEM_FOLDERS.has(oldName)) {
      throw new MailboxError(`Cannot rename system folder: ${oldName}`);
    }
    await this.pool.withConnection(async (client) => {
      await client.mailboxRename(oldName, newName);
    });
  }

  async createLabel(name: string): Promise<void> {
    await this.pool.withConnection(async (client) => {
      await client.mailboxCreate(`Labels/${name}`);
    });
  }
}
