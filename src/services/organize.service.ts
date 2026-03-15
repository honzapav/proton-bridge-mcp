import type { ImapPool } from '../connection/imap-pool.js';

export class OrganizeService {
  private readonly pool: ImapPool;

  constructor(pool: ImapPool) {
    this.pool = pool;
  }

  async moveEmails(folder: string, uids: number[], destination: string): Promise<void> {
    const uidStr = uids.join(',');
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageMove(uidStr, destination, { uid: true });
    });
  }

  async markAsRead(folder: string, uids: number[]): Promise<void> {
    const uidStr = uids.join(',');
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageFlagsAdd(uidStr, ['\\Seen'], { uid: true });
    });
  }

  async markAsUnread(folder: string, uids: number[]): Promise<void> {
    const uidStr = uids.join(',');
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageFlagsRemove(uidStr, ['\\Seen'], { uid: true });
    });
  }

  async starEmail(folder: string, uids: number[]): Promise<void> {
    const uidStr = uids.join(',');
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageFlagsAdd(uidStr, ['\\Flagged'], { uid: true });
    });
  }

  async unstarEmail(folder: string, uids: number[]): Promise<void> {
    const uidStr = uids.join(',');
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageFlagsRemove(uidStr, ['\\Flagged'], { uid: true });
    });
  }

  async applyLabels(folder: string, uids: number[], labels: string[]): Promise<void> {
    const uidStr = uids.join(',');
    await this.pool.withMailbox(folder, async (client) => {
      for (const label of labels) {
        await client.messageCopy(uidStr, `Labels/${label}`, { uid: true });
      }
    });
  }

  async removeLabels(folder: string, uids: number[], labels: string[]): Promise<void> {
    // First, fetch Message-IDs from envelopes in the source folder.
    const messageIds: string[] = await this.pool.withMailbox(folder, async (client) => {
      const uidStr = uids.join(',');
      const messages = await client.fetchAll(uidStr, { envelope: true }, { uid: true });
      return messages
        .map((m) => m.envelope?.messageId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    });

    if (messageIds.length === 0) return;

    // For each label folder, find and delete matching messages.
    for (const label of labels) {
      const labelPath = `Labels/${label}`;
      await this.pool.withMailbox(labelPath, async (client) => {
        for (const msgId of messageIds) {
          const found = await client.search(
            { header: { 'message-id': msgId } },
            { uid: true },
          );
          if (found && found.length > 0) {
            const foundStr = found.join(',');
            await client.messageFlagsAdd(foundStr, ['\\Deleted'], { uid: true });
            await client.messageDelete(foundStr, { uid: true });
          }
        }
      });
    }
  }
}
