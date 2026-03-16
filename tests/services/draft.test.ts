import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildRfc822, DraftService } from '../../src/services/draft.service.js';
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
    getEmailHeaders: vi.fn().mockResolvedValue({
      subject: 'Original subject',
      from: [{ address: 'sender@example.com', name: 'Sender' }],
      to: [{ address: 'me@example.com' }],
      cc: [],
      date: '2024-01-15T10:00:00Z',
      messageId: '<original-123@example.com>',
      references: '<earlier@example.com>',
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

  describe('saveReplyDraft', () => {
    it('sets threading headers from the original email', async () => {
      const saveSpy = vi.spyOn(service, 'saveDraft').mockResolvedValueOnce();
      await service.saveReplyDraft('INBOX', 42, 'Thanks for your email.');

      expect(messageService.getEmailHeaders).toHaveBeenCalledWith('INBOX', 42);
      const draft = saveSpy.mock.calls[0]![0];
      expect(draft.inReplyTo).toBe('<original-123@example.com>');
      expect(draft.references).toBe('<earlier@example.com> <original-123@example.com>');
    });

    it('adds Re: prefix to subject', async () => {
      const saveSpy = vi.spyOn(service, 'saveDraft').mockResolvedValueOnce();
      await service.saveReplyDraft('INBOX', 42, 'Reply body');

      expect(saveSpy.mock.calls[0]![0].subject).toBe('Re: Original subject');
    });

    it('does not double Re: prefix', async () => {
      messageService.getEmailHeaders.mockResolvedValueOnce({
        subject: 'Re: Already replied',
        from: [{ address: 'sender@example.com' }],
        to: [{ address: 'me@example.com' }],
        cc: [],
        date: '2024-01-15T10:00:00Z',
        messageId: '<msg@example.com>',
        references: undefined,
      });
      const saveSpy = vi.spyOn(service, 'saveDraft').mockResolvedValueOnce();
      await service.saveReplyDraft('INBOX', 42, 'Reply body');

      expect(saveSpy.mock.calls[0]![0].subject).toBe('Re: Already replied');
    });

    it('sets to field to the original sender', async () => {
      const saveSpy = vi.spyOn(service, 'saveDraft').mockResolvedValueOnce();
      await service.saveReplyDraft('INBOX', 42, 'Reply body');

      expect(saveSpy.mock.calls[0]![0].to).toEqual([
        { address: 'sender@example.com', name: 'Sender' },
      ]);
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

    it('preserves threading headers from existing draft when not provided in update', async () => {
      messageService.getEmail.mockResolvedValueOnce({
        uid: 1,
        subject: 'Re: Thread test',
        from: [{ address: 'user@example.com' }],
        to: [{ address: 'recipient@example.com' }],
        cc: [],
        date: '2024-01-15T10:00:00Z',
        flags: ['\\Draft'],
        hasAttachments: false,
        textBody: 'Original reply body',
        htmlBody: '',
        headers: {
          'in-reply-to': '<parent@example.com>',
          'references': '<root@example.com> <parent@example.com>',
        },
        attachments: [],
      });

      const saveSpy = vi.spyOn(service, 'saveDraft').mockResolvedValueOnce();
      await service.updateDraft(1, {
        to: [{ address: 'recipient@example.com' }],
        subject: 'Re: Thread test',
        body: 'Updated reply body',
      });

      const merged = saveSpy.mock.calls[0]![0];
      expect(merged.inReplyTo).toBe('<parent@example.com>');
      expect(merged.references).toBe('<root@example.com> <parent@example.com>');
    });

    it('uses explicit threading headers over existing ones', async () => {
      messageService.getEmail.mockResolvedValueOnce({
        uid: 1,
        subject: 'Re: Thread test',
        from: [{ address: 'user@example.com' }],
        to: [{ address: 'recipient@example.com' }],
        cc: [],
        date: '2024-01-15T10:00:00Z',
        flags: ['\\Draft'],
        hasAttachments: false,
        textBody: 'Body',
        htmlBody: '',
        headers: {
          'in-reply-to': '<old@example.com>',
          'references': '<old@example.com>',
        },
        attachments: [],
      });

      const saveSpy = vi.spyOn(service, 'saveDraft').mockResolvedValueOnce();
      await service.updateDraft(1, {
        to: [{ address: 'recipient@example.com' }],
        subject: 'Re: Thread test',
        body: 'Body',
        inReplyTo: '<new@example.com>',
        references: '<new@example.com>',
      });

      const merged = saveSpy.mock.calls[0]![0];
      expect(merged.inReplyTo).toBe('<new@example.com>');
      expect(merged.references).toBe('<new@example.com>');
    });
  });
});

function parseMimeHeaders(buf: Buffer): Record<string, string> {
  const raw = buf.toString('utf-8');
  const headerBlock = raw.split(/\r?\n\r?\n/)[0] ?? '';
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      headers[line.slice(0, idx).toLowerCase().trim()] = line.slice(idx + 1).trim();
    }
  }
  return headers;
}

describe('buildRfc822 threading headers', () => {
  const base: DraftInput = {
    to: [{ address: 'alice@example.com' }],
    subject: 'Re: Test thread',
    body: 'Reply body.',
  };

  it('sets In-Reply-To when inReplyTo is provided', async () => {
    const buf = await buildRfc822({ ...base, inReplyTo: '<orig@example.com>' });
    expect(parseMimeHeaders(buf)['in-reply-to']).toBe('<orig@example.com>');
  });

  it('sets References when references is provided', async () => {
    const buf = await buildRfc822({ ...base, references: '<a@x.com> <b@x.com>' });
    const refs = parseMimeHeaders(buf)['references'];
    expect(refs).toContain('<a@x.com>');
    expect(refs).toContain('<b@x.com>');
  });

  it('omits threading headers when not provided', async () => {
    const buf = await buildRfc822(base);
    const h = parseMimeHeaders(buf);
    expect(h['in-reply-to']).toBeUndefined();
    expect(h['references']).toBeUndefined();
  });
});
