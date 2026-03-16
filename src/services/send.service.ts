import { createTransport, type Transporter } from 'nodemailer';
import type { MessageService } from './message.service.js';

export interface SmtpConfig {
  host: string;
  port: number;
  auth: { user: string; pass: string };
}

export class SendService {
  private readonly transport: Transporter;
  private readonly messageService: MessageService;

  constructor(config: SmtpConfig, messageService: MessageService) {
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      tls: { rejectUnauthorized: false },
      auth: config.auth,
    });
    this.messageService = messageService;
  }

  async sendReply(
    folder: string,
    uid: number,
    body: string,
    options?: {
      html?: string;
      from?: string;
      cc?: string[];
      bcc?: string[];
    },
  ): Promise<void> {
    const headers = await this.messageService.getEmailHeaders(folder, uid);

    const subject = headers.subject.startsWith('Re: ')
      ? headers.subject
      : `Re: ${headers.subject}`;

    const to = headers.from.map((a) =>
      a.name ? `"${a.name}" <${a.address}>` : a.address,
    );

    const refParts: string[] = [];
    if (headers.references) {
      refParts.push(headers.references);
    }
    if (headers.messageId) {
      refParts.push(headers.messageId);
    }

    await this.transport.sendMail({
      from: options?.from,
      to: to.join(', '),
      cc: options?.cc?.join(', '),
      bcc: options?.bcc?.join(', '),
      subject,
      text: body,
      html: options?.html,
      inReplyTo: headers.messageId || undefined,
      references: refParts.length > 0 ? refParts.join(' ') : undefined,
    });
  }

  async send(
    to: string[],
    subject: string,
    body: string,
    options?: {
      html?: string;
      from?: string;
      cc?: string[];
      bcc?: string[];
      inReplyTo?: string;
      references?: string;
    },
  ): Promise<void> {
    await this.transport.sendMail({
      from: options?.from,
      to: to.join(', '),
      cc: options?.cc?.join(', '),
      bcc: options?.bcc?.join(', '),
      subject,
      text: body,
      html: options?.html,
      inReplyTo: options?.inReplyTo,
      references: options?.references,
    });
  }
}
