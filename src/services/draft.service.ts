import { createTransport } from 'nodemailer';
import type { Readable } from 'node:stream';
import type { ImapPool } from '../connection/imap-pool.js';
import type { MessageService } from './message.service.js';
import type { DraftInput, EmailMeta } from '../types.js';

export async function buildRfc822(input: DraftInput): Promise<Buffer> {
  const transport = createTransport({ streamTransport: true, newline: 'crlf' });

  const toAddresses = input.to.map((a) =>
    a.name ? `"${a.name}" <${a.address}>` : a.address,
  );

  const fromAddress = input.from
    ? input.from.name
      ? `"${input.from.name}" <${input.from.address}>`
      : input.from.address
    : undefined;

  const ccAddresses = input.cc?.map((a) =>
    a.name ? `"${a.name}" <${a.address}>` : a.address,
  );

  const bccAddresses = input.bcc?.map((a) =>
    a.name ? `"${a.name}" <${a.address}>` : a.address,
  );

  const attachments = input.attachments?.map((att) => ({
    filename: att.filename,
    contentType: att.contentType,
    content: Buffer.from(att.content, 'base64'),
  }));

  const info = await transport.sendMail({
    from: fromAddress,
    to: toAddresses.join(', '),
    cc: ccAddresses?.join(', '),
    bcc: bccAddresses?.join(', '),
    subject: input.subject,
    text: input.body,
    html: input.html,
    inReplyTo: input.inReplyTo,
    references: input.references,
    attachments,
  });

  const msg = info.message;
  if (Buffer.isBuffer(msg)) {
    return msg;
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = msg as Readable;
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export class DraftService {
  private readonly pool: ImapPool;
  private readonly messageService: MessageService;

  constructor(pool: ImapPool, messageService: MessageService) {
    this.pool = pool;
    this.messageService = messageService;
  }

  async saveDraft(input: DraftInput): Promise<void> {
    const raw = await buildRfc822(input);
    await this.pool.withConnection(async (client) => {
      await client.append('Drafts', raw, ['\\Draft', '\\Seen']);
    });
  }

  async listDrafts(limit: number, offset: number): Promise<EmailMeta[]> {
    return this.messageService.listEmails('Drafts', limit, offset);
  }

  async saveReplyDraft(
    folder: string,
    uid: number,
    body: string,
    options?: {
      html?: string;
      cc?: { address: string; name?: string }[];
      bcc?: { address: string; name?: string }[];
      from?: { address: string; name?: string };
    },
  ): Promise<void> {
    const headers = await this.messageService.getEmailHeaders(folder, uid);

    const subject = headers.subject.startsWith('Re: ')
      ? headers.subject
      : `Re: ${headers.subject}`;

    // Reply goes to the original sender.
    const to = headers.from;

    // Build References chain: existing references + original messageId.
    const refParts: string[] = [];
    if (headers.references) {
      refParts.push(headers.references);
    }
    if (headers.messageId) {
      refParts.push(headers.messageId);
    }

    await this.saveDraft({
      to,
      subject,
      body,
      html: options?.html,
      from: options?.from,
      cc: options?.cc,
      bcc: options?.bcc,
      inReplyTo: headers.messageId || undefined,
      references: refParts.length > 0 ? refParts.join(' ') : undefined,
    });
  }

  async updateDraft(uid: number, input: DraftInput): Promise<void> {
    // Fetch the existing draft to merge fields.
    const existing = await this.messageService.getEmail('Drafts', uid, false);

    const merged: DraftInput = {
      to: input.to ?? existing.to,
      subject: input.subject ?? existing.subject,
      body: input.body ?? existing.textBody,
      html: input.html,
      from: input.from ?? (existing.from[0] ?? undefined),
      cc: input.cc ?? existing.cc,
      bcc: input.bcc,
      inReplyTo: input.inReplyTo ?? existing.headers['in-reply-to'],
      references: input.references ?? existing.headers['references'],
      attachments: input.attachments,
    };

    // Delete old draft.
    await this.pool.withMailbox('Drafts', async (client) => {
      await client.messageFlagsAdd(String(uid), ['\\Deleted'], { uid: true });
      await client.messageDelete(String(uid), { uid: true });
    });

    // Save new draft.
    await this.saveDraft(merged);
  }
}
