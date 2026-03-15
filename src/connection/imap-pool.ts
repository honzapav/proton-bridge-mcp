import { ImapFlow } from 'imapflow';
import { ConnectionError } from '../errors.js';
import type { PoolStats } from '../types.js';

export interface ImapPoolConfig {
  host: string;
  port: number;
  auth: { user: string; pass: string };
  poolSize: number;
  acquireTimeout: number;
  commandTimeout: number;
  idleTimeout: number;
}

// A PooledConnection is just an ImapFlow instance tracked in the pool.
type PooledConnection = ImapFlow;

interface WaitingEntry {
  resolve: (client: PooledConnection) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ImapPool {
  private readonly config: ImapPoolConfig;
  private available: PooledConnection[] = [];
  private readonly inUse: Set<PooledConnection> = new Set();
  private readonly waiting: WaitingEntry[] = [];
  private closed = false;

  constructor(config: ImapPoolConfig) {
    this.config = config;
  }

  // Create and connect a new ImapFlow client.
  private async createConnection(): Promise<PooledConnection> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: false,
      tls: { rejectUnauthorized: false },
      auth: this.config.auth,
      logger: false,
    });

    client.on('error', () => {
      this.removeClient(client);
    });

    client.on('close', () => {
      this.removeClient(client);
    });

    try {
      await client.connect();
    } catch (err) {
      throw new ConnectionError(
        err instanceof Error ? err.message : String(err),
      );
    }

    return client;
  }

  // Remove a client from both available and inUse tracking.
  private removeClient(client: PooledConnection): void {
    this.inUse.delete(client);
    const idx = this.available.indexOf(client);
    if (idx !== -1) {
      this.available.splice(idx, 1);
    }
  }

  // Acquire a connection from the pool.
  async acquire(): Promise<PooledConnection> {
    if (this.closed) {
      throw new ConnectionError('Connection pool is closed.');
    }

    // Try to reuse an available usable connection.
    while (this.available.length > 0) {
      const client = this.available.pop()!;
      if (client.usable) {
        this.inUse.add(client);
        return client;
      }
      // Discard unusable connections silently.
    }

    // Create a new connection if under the size limit.
    const total = this.inUse.size + this.available.length;
    if (total < this.config.poolSize) {
      const client = await this.createConnection();
      this.inUse.add(client);
      return client;
    }

    // Wait for a connection to be released.
    return new Promise<PooledConnection>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiting.indexOf(entry);
        if (idx !== -1) {
          this.waiting.splice(idx, 1);
        }
        reject(
          new ConnectionError(
            `Timed out waiting for a connection after ${this.config.acquireTimeout}ms.`,
          ),
        );
      }, this.config.acquireTimeout);

      const entry: WaitingEntry = { resolve, reject, timer };
      this.waiting.push(entry);
    });
  }

  // Return a connection back to the pool.
  release(client: PooledConnection): void {
    this.inUse.delete(client);

    if (this.waiting.length > 0) {
      const entry = this.waiting.shift()!;
      clearTimeout(entry.timer);
      this.inUse.add(client);
      entry.resolve(client);
      return;
    }

    if (!this.closed && client.usable) {
      this.available.push(client);
    } else {
      // Attempt a best-effort close without blocking.
      client.logout().catch(() => {
        client.close();
      });
    }
  }

  // Run a function with an acquired connection, releasing afterwards.
  async withConnection<T>(fn: (client: PooledConnection) => Promise<T>): Promise<T> {
    const client = await this.acquire();
    try {
      return await fn(client);
    } finally {
      this.release(client);
    }
  }

  // Run a function with a mailbox lock on the given folder.
  async withMailbox<T>(
    folder: string,
    fn: (client: PooledConnection) => Promise<T>,
  ): Promise<T> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        return await fn(client);
      } finally {
        lock.release();
      }
    });
  }

  // Return current pool statistics.
  getStats(): PoolStats {
    return {
      total: this.inUse.size + this.available.length,
      inUse: this.inUse.size,
      available: this.available.length,
      waiting: this.waiting.length,
    };
  }

  // Return true if there are any connections tracked (in-use or available).
  isConnected(): boolean {
    return this.inUse.size > 0 || this.available.length > 0;
  }

  // Close all connections and reject any pending waiters.
  async shutdown(): Promise<void> {
    this.closed = true;

    // Reject all waiters.
    for (const entry of this.waiting) {
      clearTimeout(entry.timer);
      entry.reject(new ConnectionError('Connection pool shut down.'));
    }
    this.waiting.length = 0;

    // Close all available connections.
    const toClose = [...this.available, ...this.inUse];
    this.available = [];
    this.inUse.clear();

    await Promise.allSettled(
      toClose.map((client) =>
        client.logout().catch(() => {
          client.close();
        }),
      ),
    );
  }
}
