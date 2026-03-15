import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MailboxService, classifyFolder } from '../../src/services/mailbox.service.js';
import { MailboxError } from '../../src/errors.js';

function makeMailboxEntry(path: string, name: string, specialUse?: string) {
  return {
    path,
    name,
    delimiter: '/',
    flags: new Set<string>(),
    specialUse: specialUse ?? undefined,
  };
}

function makePool(listResult: ReturnType<typeof makeMailboxEntry>[]) {
  const client = {
    list: vi.fn().mockResolvedValue(listResult),
    mailboxCreate: vi.fn().mockResolvedValue(undefined),
    mailboxRename: vi.fn().mockResolvedValue(undefined),
  };
  return {
    withConnection: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(client)),
    _client: client,
  };
}

describe('classifyFolder', () => {
  it('classifies INBOX as system', () => {
    expect(classifyFolder('INBOX')).toBe('system');
  });

  it('classifies Sent as system', () => {
    expect(classifyFolder('Sent')).toBe('system');
  });

  it('classifies folder with specialUse as system', () => {
    expect(classifyFolder('SomeFolder', '\\Sent')).toBe('system');
  });

  it('classifies Labels/foo as label', () => {
    expect(classifyFolder('Labels/foo')).toBe('label');
  });

  it('classifies Folders/bar as folder', () => {
    expect(classifyFolder('Folders/bar')).toBe('folder');
  });

  it('classifies unknown path without specialUse as folder', () => {
    expect(classifyFolder('MyCustomFolder')).toBe('folder');
  });
});

describe('MailboxService', () => {
  describe('listFolders', () => {
    it('classifies system, folder, and label types correctly', async () => {
      const pool = makePool([
        makeMailboxEntry('INBOX', 'INBOX'),
        makeMailboxEntry('Folders/Work', 'Work'),
        makeMailboxEntry('Labels/urgent', 'urgent'),
      ]);
      const service = new MailboxService(pool as never);
      const folders = await service.listFolders();

      expect(folders).toHaveLength(3);
      const byPath = Object.fromEntries(folders.map((f) => [f.path, f]));
      expect(byPath['INBOX'].type).toBe('system');
      expect(byPath['Folders/Work'].type).toBe('folder');
      expect(byPath['Labels/urgent'].type).toBe('label');
    });

    it('includes path, name, delimiter, and flags', async () => {
      const pool = makePool([makeMailboxEntry('INBOX', 'INBOX')]);
      const service = new MailboxService(pool as never);
      const folders = await service.listFolders();
      expect(folders[0].path).toBe('INBOX');
      expect(folders[0].name).toBe('INBOX');
      expect(folders[0].delimiter).toBe('/');
      expect(Array.isArray(folders[0].flags)).toBe(true);
    });
  });

  describe('listLabels', () => {
    it('returns only labels', async () => {
      const pool = makePool([
        makeMailboxEntry('INBOX', 'INBOX'),
        makeMailboxEntry('Folders/Work', 'Work'),
        makeMailboxEntry('Labels/urgent', 'urgent'),
        makeMailboxEntry('Labels/todo', 'todo'),
      ]);
      const service = new MailboxService(pool as never);
      const labels = await service.listLabels();
      expect(labels).toHaveLength(2);
      expect(labels.every((l) => l.type === 'label')).toBe(true);
    });
  });

  describe('createFolder', () => {
    it('prepends Folders/ prefix', async () => {
      const pool = makePool([]);
      const service = new MailboxService(pool as never);
      await service.createFolder('Work');
      expect(pool._client.mailboxCreate).toHaveBeenCalledWith('Folders/Work');
    });

    it('includes parent in path when provided', async () => {
      const pool = makePool([]);
      const service = new MailboxService(pool as never);
      await service.createFolder('Subproject', 'Work');
      expect(pool._client.mailboxCreate).toHaveBeenCalledWith('Folders/Work/Subproject');
    });
  });

  describe('renameFolder', () => {
    it('throws MailboxError when renaming a system folder', async () => {
      const pool = makePool([]);
      const service = new MailboxService(pool as never);
      await expect(service.renameFolder('INBOX', 'NewName')).rejects.toBeInstanceOf(MailboxError);
    });

    it('calls mailboxRename for non-system folders', async () => {
      const pool = makePool([]);
      const service = new MailboxService(pool as never);
      await service.renameFolder('Folders/Work', 'Folders/NewWork');
      expect(pool._client.mailboxRename).toHaveBeenCalledWith('Folders/Work', 'Folders/NewWork');
    });
  });

  describe('createLabel', () => {
    it('prepends Labels/ prefix', async () => {
      const pool = makePool([]);
      const service = new MailboxService(pool as never);
      await service.createLabel('urgent');
      expect(pool._client.mailboxCreate).toHaveBeenCalledWith('Labels/urgent');
    });
  });
});
