import PostalMime from 'postal-mime';
import type { ImapPool } from '../connection/imap-pool.js';
import type {
  Email,
  EmailAddress,
  EmailHeaders,
  EmailMeta,
  AttachmentContent,
  AttachmentMeta,
  SearchCriteria,
} from '../types.js';
import type {
  FetchMessageObject,
  MessageAddressObject,
  MessageStructureObject,
} from 'imapflow';

// Convert a single IMAP address object to our EmailAddress shape.
function toEmailAddress(addr: MessageAddressObject): EmailAddress {
  return {
    name: addr.name ?? undefined,
    address: addr.address ?? '',
  };
}

// Convert an optional array of IMAP address objects to EmailAddress[].
function toEmailAddresses(addrs: MessageAddressObject[] | null | undefined): EmailAddress[] {
  if (!addrs) return [];
  return addrs.map(toEmailAddress);
}

// Recursively check whether a body structure contains attachment parts.
function hasAttachmentParts(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  if (node.childNodes) {
    return node.childNodes.some(hasAttachmentParts);
  }
  return false;
}

// Build an imapflow SearchObject from our SearchCriteria type.
// hasAttachment is handled client-side since IMAP has no direct equivalent.
function buildSearchQuery(criteria: SearchCriteria): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  if (criteria.from !== undefined) query.from = criteria.from;
  if (criteria.to !== undefined) query.to = criteria.to;
  if (criteria.subject !== undefined) query.subject = criteria.subject;
  if (criteria.body !== undefined) query.body = criteria.body;
  if (criteria.since !== undefined) query.since = new Date(criteria.since);
  if (criteria.before !== undefined) query.before = new Date(criteria.before);
  if (criteria.isUnread === true) query.seen = false;
  if (criteria.isUnread === false) query.seen = true;

  // hasAttachment is not expressible in standard IMAP; filter client-side.

  if (Object.keys(query).length === 0) {
    query.all = true;
  }

  return query;
}

// Map a FetchMessageObject to our EmailMeta shape.
function toEmailMeta(msg: FetchMessageObject): EmailMeta {
  const env = msg.envelope ?? {};
  return {
    uid: msg.uid,
    subject: env.subject ?? '(no subject)',
    from: toEmailAddresses(env.from),
    to: toEmailAddresses(env.to),
    cc: toEmailAddresses(env.cc),
    date: env.date ? env.date.toISOString() : '',
    flags: msg.flags ? Array.from(msg.flags) : [],
    hasAttachments: hasAttachmentParts(msg.bodyStructure),
    messageId: env.messageId ?? undefined,
  };
}

export class MessageService {
  private readonly pool: ImapPool;

  constructor(pool: ImapPool) {
    this.pool = pool;
  }

  // List emails in a folder, newest-first, with pagination.
  async listEmails(folder: string, limit: number, offset: number): Promise<EmailMeta[]> {
    return this.pool.withMailbox(folder, async (client) => {
      const messages = await client.fetchAll('1:*', {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      });

      // Reverse so newest (highest sequence) comes first.
      const reversed = [...messages].reverse();

      // Apply pagination.
      return reversed.slice(offset, offset + limit).map(toEmailMeta);
    });
  }

  // Fetch a full email by UID, optionally including attachment content.
  async getEmail(folder: string, uid: number, includeAttachments: boolean): Promise<Email> {
    return this.pool.withMailbox(folder, async (client) => {
      const msg = await client.fetchOne(String(uid), { source: true, envelope: true, flags: true }, { uid: true });

      if (!msg || !msg.source) {
        throw new Error(`Message UID ${uid} not found in ${folder}.`);
      }

      const parsed = await PostalMime.parse(msg.source);
      const env = msg.envelope ?? {};

      const attachments: AttachmentMeta[] = parsed.attachments.map((a) => ({
        filename: a.filename ?? 'unnamed',
        contentType: a.mimeType,
        size: a.content instanceof ArrayBuffer ? a.content.byteLength : Buffer.from(String(a.content), 'base64').byteLength,
        contentId: a.contentId ?? undefined,
      }));

      const attachmentContents: AttachmentContent[] = includeAttachments
        ? parsed.attachments.map((a) => {
            let contentBase64: string;
            if (a.content instanceof ArrayBuffer) {
              contentBase64 = Buffer.from(a.content).toString('base64');
            } else {
              // postal-mime returns base64 string when encoding is 'base64'
              contentBase64 = String(a.content);
            }
            return {
              filename: a.filename ?? 'unnamed',
              contentType: a.mimeType,
              size: attachments.find((at) => at.filename === (a.filename ?? 'unnamed'))?.size ?? 0,
              contentId: a.contentId ?? undefined,
              content: contentBase64,
            };
          })
        : [];

      // Build a flat headers map.
      const headers: Record<string, string> = {};
      for (const h of parsed.headers) {
        headers[h.key] = h.value;
      }

      return {
        uid: msg.uid,
        subject: env.subject ?? parsed.subject ?? '(no subject)',
        from: toEmailAddresses(env.from),
        to: toEmailAddresses(env.to),
        cc: toEmailAddresses(env.cc),
        date: env.date ? env.date.toISOString() : (parsed.date ?? ''),
        flags: msg.flags ? Array.from(msg.flags) : [],
        hasAttachments: attachments.length > 0,
        messageId: env.messageId ?? parsed.messageId ?? undefined,
        textBody: parsed.text ?? '',
        htmlBody: parsed.html ?? '',
        headers,
        attachments: includeAttachments ? attachmentContents : attachments,
      };
    });
  }

  // Fetch envelope and headers for a message.
  async getEmailHeaders(folder: string, uid: number): Promise<EmailHeaders> {
    return this.pool.withMailbox(folder, async (client) => {
      const msg = await client.fetchOne(
        String(uid),
        { envelope: true, headers: true },
        { uid: true },
      );

      if (!msg) {
        throw new Error(`Message UID ${uid} not found in ${folder}.`);
      }

      const env = msg.envelope ?? {};

      // Parse References from raw headers buffer.
      let references: string | undefined;
      if (msg.headers) {
        const raw = msg.headers.toString('utf-8');
        const match = raw.match(/^references:\s*(.+?)(?=\r?\n\S|\r?\n\r?\n|$)/im);
        if (match) {
          references = match[1].trim();
        }
      }

      return {
        subject: env.subject ?? '(no subject)',
        from: toEmailAddresses(env.from),
        to: toEmailAddresses(env.to),
        cc: toEmailAddresses(env.cc),
        date: env.date ? env.date.toISOString() : '',
        messageId: env.messageId ?? '',
        inReplyTo: env.inReplyTo ?? undefined,
        references,
      };
    });
  }

  // Search emails in a folder using criteria, with pagination.
  async searchEmails(
    folder: string,
    criteria: SearchCriteria,
    limit: number,
    offset: number,
  ): Promise<EmailMeta[]> {
    return this.pool.withMailbox(folder, async (client) => {
      const query = buildSearchQuery(criteria);
      const uids = await client.search(query, { uid: true });

      if (!uids || uids.length === 0) return [];

      // Paginate UIDs (already returned newest-first by server in many cases;
      // we reverse to ensure newest-first ordering).
      const sorted = [...uids].sort((a, b) => b - a);
      const page = sorted.slice(offset, offset + limit);

      if (page.length === 0) return [];

      const messages = await client.fetchAll(page.join(','), {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      }, { uid: true });

      // Apply client-side hasAttachment filter if requested.
      let results = messages.map(toEmailMeta);
      if (criteria.hasAttachment === true) {
        results = results.filter((m) => m.hasAttachments);
      } else if (criteria.hasAttachment === false) {
        results = results.filter((m) => !m.hasAttachments);
      }

      // Return newest-first.
      return results.sort((a, b) => b.uid - a.uid);
    });
  }

  // Return the count of unread messages in a folder.
  async getUnreadCount(folder: string): Promise<number> {
    return this.pool.withConnection(async (client) => {
      const statusResult = await client.status(folder, { unseen: true });
      return statusResult?.unseen ?? 0;
    });
  }
}
