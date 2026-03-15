import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrganizeService } from '../../src/services/organize.service.js';

function makeClient() {
  return {
    messageMove: vi.fn().mockResolvedValue(undefined),
    messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
    messageFlagsRemove: vi.fn().mockResolvedValue(undefined),
    messageCopy: vi.fn().mockResolvedValue(undefined),
    messageDelete: vi.fn().mockResolvedValue(undefined),
    fetchAll: vi.fn().mockResolvedValue([
      {
        uid: 1,
        envelope: { messageId: '<msg1@example.com>' },
      },
      {
        uid: 2,
        envelope: { messageId: '<msg2@example.com>' },
      },
    ]),
    search: vi.fn().mockResolvedValue([10]),
  };
}

function makePool() {
  const client = makeClient();
  return {
    withMailbox: vi.fn(async (
      _folder: string,
      fn: (client: unknown) => Promise<unknown>,
    ) => fn(client)),
    withConnection: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(client)),
    _client: client,
  };
}

describe('OrganizeService', () => {
  let pool: ReturnType<typeof makePool>;
  let service: OrganizeService;

  beforeEach(() => {
    pool = makePool();
    service = new OrganizeService(pool as never);
  });

  describe('moveEmails', () => {
    it('calls IMAP messageMove with joined UIDs and destination', async () => {
      await service.moveEmails('INBOX', [1, 2, 3], 'Archive');
      expect(pool._client.messageMove).toHaveBeenCalledWith('1,2,3', 'Archive', { uid: true });
    });

    it('calls withMailbox with the source folder', async () => {
      await service.moveEmails('INBOX', [1], 'Sent');
      expect(pool.withMailbox).toHaveBeenCalledWith('INBOX', expect.any(Function));
    });
  });

  describe('markAsRead', () => {
    it('adds \\Seen flag via messageFlagsAdd', async () => {
      await service.markAsRead('INBOX', [5, 6]);
      expect(pool._client.messageFlagsAdd).toHaveBeenCalledWith('5,6', ['\\Seen'], { uid: true });
    });
  });

  describe('markAsUnread', () => {
    it('removes \\Seen flag via messageFlagsRemove', async () => {
      await service.markAsUnread('INBOX', [5]);
      expect(pool._client.messageFlagsRemove).toHaveBeenCalledWith('5', ['\\Seen'], { uid: true });
    });
  });

  describe('starEmail', () => {
    it('adds \\Flagged flag', async () => {
      await service.starEmail('INBOX', [7]);
      expect(pool._client.messageFlagsAdd).toHaveBeenCalledWith('7', ['\\Flagged'], { uid: true });
    });
  });

  describe('unstarEmail', () => {
    it('removes \\Flagged flag', async () => {
      await service.unstarEmail('INBOX', [7]);
      expect(pool._client.messageFlagsRemove).toHaveBeenCalledWith('7', ['\\Flagged'], { uid: true });
    });
  });

  describe('applyLabels', () => {
    it('uses messageCopy (not messageMove) for each label', async () => {
      await service.applyLabels('INBOX', [1, 2], ['urgent', 'todo']);
      expect(pool._client.messageCopy).toHaveBeenCalledWith('1,2', 'Labels/urgent', { uid: true });
      expect(pool._client.messageCopy).toHaveBeenCalledWith('1,2', 'Labels/todo', { uid: true });
      // Critical: messageMove must NOT be called
      expect(pool._client.messageMove).not.toHaveBeenCalled();
    });

    it('calls withMailbox with the source folder', async () => {
      await service.applyLabels('INBOX', [1], ['tag']);
      expect(pool.withMailbox).toHaveBeenCalledWith('INBOX', expect.any(Function));
    });
  });

  describe('removeLabels', () => {
    it('fetches envelopes then searches and deletes in label folders', async () => {
      await service.removeLabels('INBOX', [1, 2], ['urgent']);
      // Should have fetched envelopes from source folder
      expect(pool._client.fetchAll).toHaveBeenCalled();
      // Should have searched in label folder
      expect(pool._client.search).toHaveBeenCalled();
      // Should have marked deleted and expunged
      expect(pool._client.messageFlagsAdd).toHaveBeenCalledWith(
        expect.any(String),
        ['\\Deleted'],
        { uid: true },
      );
      expect(pool._client.messageDelete).toHaveBeenCalled();
    });
  });
});
