import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImapPool } from '../../src/connection/imap-pool.js';
import { ConnectionError } from '../../src/errors.js';

// Mock ImapFlow using a proper class so 'new ImapFlow(...)' works.
vi.mock('imapflow', () => {
  class MockImapFlow {
    usable = true;
    private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

    connect = vi.fn().mockResolvedValue(undefined);
    logout = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
    getMailboxLock = vi.fn().mockResolvedValue({ path: 'INBOX', release: vi.fn() });
    status = vi.fn().mockResolvedValue({ path: 'INBOX', unseen: 5 });

    on(event: string, handler: (...args: unknown[]) => void): this {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(handler);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      if (this.listeners[event]) {
        for (const h of this.listeners[event]) h(...args);
      }
    }
  }

  return { ImapFlow: MockImapFlow };
});

const baseConfig = {
  host: '127.0.0.1',
  port: 1143,
  auth: { user: 'test@example.com', pass: 'secret' },
  poolSize: 3,
  acquireTimeout: 500,
  commandTimeout: 5000,
  idleTimeout: 60000,
};

describe('ImapPool', () => {
  let pool: ImapPool;

  beforeEach(() => {
    pool = new ImapPool(baseConfig);
  });

  afterEach(async () => {
    await pool.shutdown();
    vi.clearAllMocks();
  });

  it('creates a connection on first acquire', async () => {
    const client = await pool.acquire();
    expect(client).toBeDefined();
    expect(client.usable).toBe(true);
    pool.release(client);
  });

  it('returns the same connection on second acquire after release', async () => {
    const first = await pool.acquire();
    pool.release(first);
    const second = await pool.acquire();
    expect(second).toBe(first);
    pool.release(second);
  });

  it('stats start at zero before any acquire', async () => {
    const stats = pool.getStats();
    expect(stats.total).toBe(0);
    expect(stats.inUse).toBe(0);
    expect(stats.available).toBe(0);
    expect(stats.waiting).toBe(0);
  });

  it('stats reflect in-use count after acquire', async () => {
    const client = await pool.acquire();
    const stats = pool.getStats();
    expect(stats.total).toBe(1);
    expect(stats.inUse).toBe(1);
    expect(stats.available).toBe(0);
    pool.release(client);
  });

  it('stats reflect available count after release', async () => {
    const client = await pool.acquire();
    pool.release(client);
    const stats = pool.getStats();
    expect(stats.total).toBe(1);
    expect(stats.inUse).toBe(0);
    expect(stats.available).toBe(1);
  });

  it('withConnection auto-releases on success', async () => {
    await pool.withConnection(async () => {
      const s = pool.getStats();
      expect(s.inUse).toBe(1);
    });
    const stats = pool.getStats();
    expect(stats.inUse).toBe(0);
    expect(stats.available).toBe(1);
  });

  it('withConnection auto-releases on error', async () => {
    await expect(
      pool.withConnection(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const stats = pool.getStats();
    expect(stats.inUse).toBe(0);
  });

  it('creates up to poolSize connections in parallel', async () => {
    const clients = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
    ]);
    const stats = pool.getStats();
    expect(stats.total).toBe(3);
    expect(stats.inUse).toBe(3);
    for (const c of clients) pool.release(c);
  });

  it('rejects acquire after shutdown', async () => {
    await pool.shutdown();
    await expect(pool.acquire()).rejects.toThrow(ConnectionError);
  });

  it('closes all connections on shutdown', async () => {
    const client = await pool.acquire();
    pool.release(client);
    // Grab reference to mock before shutdown
    const logoutSpy = vi.spyOn(client, 'logout');
    await pool.shutdown();
    expect(logoutSpy).toHaveBeenCalled();
  });

  it('isConnected returns false when pool is empty', () => {
    expect(pool.isConnected()).toBe(false);
  });

  it('isConnected returns true after acquiring a connection', async () => {
    const client = await pool.acquire();
    expect(pool.isConnected()).toBe(true);
    pool.release(client);
  });

  it('acquire times out when pool is exhausted', async () => {
    // Fill the pool
    const clients = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
    ]);
    // A 4th acquire should time out
    await expect(pool.acquire()).rejects.toThrow(ConnectionError);
    for (const c of clients) pool.release(c);
  }, 2000);

  it('waiting acquire resolves when a connection is released', async () => {
    const clients = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
    ]);
    // Start a waiting acquire before releasing
    const waitingPromise = pool.acquire();
    // Release one so the waiter gets it
    pool.release(clients[0]);
    const resolved = await waitingPromise;
    expect(resolved).toBe(clients[0]);
    pool.release(resolved);
    pool.release(clients[1]);
    pool.release(clients[2]);
  }, 2000);
});
