// Shared types for the Proton Bridge MCP server

export interface Credentials {
  username: string;
  password: string;
}

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}

export interface AttachmentContent extends AttachmentMeta {
  // Base64-encoded content
  content: string;
}

export interface EmailMeta {
  uid: number;
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string;
  flags: string[];
  hasAttachments: boolean;
  messageId?: string;
}

export interface Email extends EmailMeta {
  textBody: string;
  htmlBody: string;
  headers: Record<string, string>;
  attachments: AttachmentMeta[];
}

export interface EmailHeaders {
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
}

export interface Folder {
  path: string;
  name: string;
  delimiter: string;
  specialUse?: string;
  type: 'system' | 'folder' | 'label';
  flags: string[];
}

export interface DraftAttachmentInput {
  filename: string;
  contentType: string;
  // Base64-encoded content
  content: string;
}

export interface DraftInput {
  to: EmailAddress[];
  subject: string;
  body: string;
  html?: string;
  from?: EmailAddress;
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  inReplyTo?: string;
  references?: string;
  attachments?: DraftAttachmentInput[];
}

export interface SearchCriteria {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  since?: string;
  before?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
}

export interface PoolStats {
  total: number;
  inUse: number;
  available: number;
  waiting: number;
}

export interface ConnectionStatus {
  imap: {
    connected: boolean;
    pool: PoolStats;
    lastError?: string;
  };
}
