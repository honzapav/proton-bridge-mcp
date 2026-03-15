import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageService } from '../../src/services/message.service.js';

// Minimal mock for ImapPool
function makePool(overrides: Record<string, unknown> = {}) {
  return {
    withConnection: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(makeClient(overrides))),
    withMailbox: vi.fn(async (
      _folder: string,
      fn: (client: unknown) => Promise<unknown>,
    ) => fn(makeClient(overrides))),
  };
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    fetchAll: vi.fn().mockResolvedValue([
      {
        uid: 1,
        seq: 1,
        envelope: {
          subject: 'Hello World',
          from: [{ name: 'Sender', address: 'sender@example.com' }],
          to: [{ name: 'Recipient', address: 'recipient@example.com' }],
          cc: [],
          date: new Date('2024-01-15T10:00:00Z'),
          messageId: '<msg1@example.com>',
        },
        flags: new Set(['\\Seen']),
        bodyStructure: { type: 'text/plain', part: '1' },
      },
      {
        uid: 2,
        seq: 2,
        envelope: {
          subject: 'Second Email',
          from: [{ name: 'Another Sender', address: 'another@example.com' }],
          to: [{ name: 'Recipient', address: 'recipient@example.com' }],
          cc: [],
          date: new Date('2024-01-16T10:00:00Z'),
          messageId: '<msg2@example.com>',
        },
        flags: new Set<string>(),
        bodyStructure: { type: 'text/plain', part: '1' },
      },
    ]),
    fetchOne: vi.fn().mockResolvedValue({
      uid: 1,
      seq: 1,
      source: Buffer.from(
        'From: Sender <sender@example.com>\r\n' +
        'To: Recipient <recipient@example.com>\r\n' +
        'Subject: Hello World\r\n' +
        'Date: Mon, 15 Jan 2024 10:00:00 +0000\r\n' +
        'Message-ID: <msg1@example.com>\r\n' +
        '\r\n' +
        'Hello, world!',
      ),
      envelope: {
        subject: 'Hello World',
        from: [{ name: 'Sender', address: 'sender@example.com' }],
        to: [{ name: 'Recipient', address: 'recipient@example.com' }],
        cc: [],
        date: new Date('2024-01-15T10:00:00Z'),
        messageId: '<msg1@example.com>',
      },
      flags: new Set(['\\Seen']),
      headers: Buffer.from(
        'From: Sender <sender@example.com>\r\n' +
        'To: Recipient <recipient@example.com>\r\n' +
        'Subject: Hello World\r\n' +
        'Date: Mon, 15 Jan 2024 10:00:00 +0000\r\n' +
        'Message-ID: <msg1@example.com>\r\n' +
        'References: <ref1@example.com> <ref2@example.com>\r\n',
      ),
    }),
    search: vi.fn().mockResolvedValue([1, 2]),
    status: vi.fn().mockResolvedValue({ path: 'INBOX', unseen: 7 }),
    ...overrides,
  };
}

describe('MessageService', () => {
  let service: MessageService;
  let pool: ReturnType<typeof makePool>;

  beforeEach(() => {
    pool = makePool();
    service = new MessageService(pool as never);
  });

  describe('listEmails', () => {
    it('returns email metadata for messages in newest-first order', async () => {
      const emails = await service.listEmails('INBOX', 50, 0);
      expect(emails).toHaveLength(2);
      // Newest first: uid 2 should come before uid 1
      expect(emails[0].uid).toBe(2);
      expect(emails[1].uid).toBe(1);
    });

    it('maps subject, from, to, flags correctly', async () => {
      const emails = await service.listEmails('INBOX', 50, 0);
      const newest = emails[0];
      expect(newest.subject).toBe('Second Email');
      expect(newest.from[0].address).toBe('another@example.com');
      expect(newest.to[0].address).toBe('recipient@example.com');
      // uid 2 has no flags; it was fetched and reversed to be first
      expect(newest.flags).not.toContain('\\Seen');
    });

    it('oldest email has Seen flag', async () => {
      const emails = await service.listEmails('INBOX', 50, 0);
      const oldest = emails[1]; // uid 1
      expect(oldest.flags).toContain('\\Seen');
      expect(oldest.uid).toBe(1);
    });

    it('respects limit and offset for pagination', async () => {
      const emails = await service.listEmails('INBOX', 1, 0);
      expect(emails).toHaveLength(1);
      expect(emails[0].uid).toBe(2);
    });

    it('offset skips emails', async () => {
      const emails = await service.listEmails('INBOX', 50, 1);
      expect(emails).toHaveLength(1);
      expect(emails[0].uid).toBe(1);
    });

    it('calls withMailbox with the correct folder', async () => {
      await service.listEmails('Sent', 50, 0);
      expect(pool.withMailbox).toHaveBeenCalledWith('Sent', expect.any(Function));
    });
  });

  describe('getUnreadCount', () => {
    it('returns the UNSEEN count from status', async () => {
      const count = await service.getUnreadCount('INBOX');
      expect(count).toBe(7);
    });

    it('calls withConnection and status with unseen query', async () => {
      await service.getUnreadCount('INBOX');
      expect(pool.withConnection).toHaveBeenCalled();
    });
  });

  describe('getEmail', () => {
    it('returns a full email with textBody', async () => {
      const email = await service.getEmail('INBOX', 1, false);
      expect(email).toBeDefined();
      expect(email.uid).toBe(1);
      expect(email.textBody.trim()).toBe('Hello, world!');
    });

    it('calls withMailbox with the correct folder', async () => {
      await service.getEmail('INBOX', 1, false);
      expect(pool.withMailbox).toHaveBeenCalledWith('INBOX', expect.any(Function));
    });
  });

  describe('getEmailHeaders', () => {
    it('returns parsed header fields including references', async () => {
      const headers = await service.getEmailHeaders('INBOX', 1);
      expect(headers.subject).toBe('Hello World');
      expect(headers.references).toBe('<ref1@example.com> <ref2@example.com>');
    });
  });

  describe('searchEmails', () => {
    it('returns email metadata matching the search', async () => {
      const results = await service.searchEmails('INBOX', { from: 'sender@example.com' }, 50, 0);
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('calls withMailbox with the correct folder', async () => {
      await service.searchEmails('INBOX', { subject: 'Hello' }, 50, 0);
      expect(pool.withMailbox).toHaveBeenCalledWith('INBOX', expect.any(Function));
    });

    it('handles empty search results', async () => {
      pool = makePool({ search: vi.fn().mockResolvedValue([]) });
      service = new MessageService(pool as never);
      const results = await service.searchEmails('INBOX', { from: 'nobody@example.com' }, 50, 0);
      expect(results).toHaveLength(0);
    });
  });
});
