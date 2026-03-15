import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DraftService } from '../../src/services/draft.service.js';
import type { DraftInput } from '../../src/types.js';

function makeClient() {
  return {
    append: vi.fn().mockResolvedValue(undefined),
    messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
    messageDelete: vi.fn().mockResolvedValue(undefined),
  };
}

function makePool() {
  const client = makeClient();
  return {
    withConnection: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(client)),
    withMailbox: vi.fn(async (
      _folder: string,
      fn: (client: unknown) => Promise<unknown>,
    ) => fn(client)),
    _client: client,
  };
}

function makeMessageService() {
  return {
    listEmails: vi.fn().mockResolvedValue([
      {
        uid: 1,
        subject: 'Draft subject',
        from: [{ address: 'user@example.com' }],
        to: [{ address: 'recipient@example.com' }],
        cc: [],
        date: '2024-01-15T10:00:00Z',
        flags: ['\\Draft'],
        hasAttachments: false,
      },
    ]),
    getEmail: vi.fn().mockResolvedValue({
      uid: 1,
      subject: 'Existing draft',
      from: [{ address: 'user@example.com' }],
      to: [{ address: 'recipient@example.com' }],
      cc: [],
      date: '2024-01-15T10:00:00Z',
      flags: ['\\Draft'],
      hasAttachments: false,
      textBody: 'Original body',
      htmlBody: '',
      headers: {},
      attachments: [],
    }),
  };
}

const sampleDraft: DraftInput = {
  to: [{ address: 'recipient@example.com' }],
  subject: 'Test Draft',
  body: 'Hello from draft',
};

describe('DraftService', () => {
  let pool: ReturnType<typeof makePool>;
  let messageService: ReturnType<typeof makeMessageService>;
  let service: DraftService;

  beforeEach(() => {
    pool = makePool();
    messageService = makeMessageService();
    service = new DraftService(pool as never, messageService as never);
  });

  describe('saveDraft', () => {
    it('appends to Drafts folder with \\Draft flag', async () => {
      await service.saveDraft(sampleDraft);
      expect(pool._client.append).toHaveBeenCalledWith(
        'Drafts',
        expect.any(Buffer),
        expect.arrayContaining(['\\Draft']),
      );
    });

    it('includes \\Seen flag alongside \\Draft', async () => {
      await service.saveDraft(sampleDraft);
      expect(pool._client.append).toHaveBeenCalledWith(
        'Drafts',
        expect.any(Buffer),
        expect.arrayContaining(['\\Seen']),
      );
    });

    it('appends a non-empty RFC822 buffer', async () => {
      await service.saveDraft(sampleDraft);
      const [, buffer] = pool._client.append.mock.calls[0] as [string, Buffer, string[]];
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('uses withConnection (not withMailbox) for append', async () => {
      await service.saveDraft(sampleDraft);
      expect(pool.withConnection).toHaveBeenCalled();
    });
  });

  describe('listDrafts', () => {
    it('delegates to MessageService.listEmails with Drafts folder', async () => {
      const result = await service.listDrafts(10, 0);
      expect(messageService.listEmails).toHaveBeenCalledWith('Drafts', 10, 0);
      expect(result).toHaveLength(1);
    });

    it('passes limit and offset through', async () => {
      await service.listDrafts(5, 10);
      expect(messageService.listEmails).toHaveBeenCalledWith('Drafts', 5, 10);
    });
  });

  describe('updateDraft', () => {
    it('fetches existing draft, deletes it, then saves a new one', async () => {
      await service.updateDraft(1, sampleDraft);
      // Should fetch existing
      expect(messageService.getEmail).toHaveBeenCalledWith('Drafts', 1, false);
      // Should delete old draft
      expect(pool._client.messageFlagsAdd).toHaveBeenCalledWith(
        '1',
        ['\\Deleted'],
        { uid: true },
      );
      expect(pool._client.messageDelete).toHaveBeenCalledWith('1', { uid: true });
      // Should append new draft
      expect(pool._client.append).toHaveBeenCalledWith(
        'Drafts',
        expect.any(Buffer),
        expect.arrayContaining(['\\Draft']),
      );
    });
  });
});
