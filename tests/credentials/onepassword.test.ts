import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CredentialError } from '../../src/errors.js';

// Mock node:child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { OnePasswordProvider } from '../../src/credentials/onepassword.js';

const mockExecFileSync = vi.mocked(execFileSync);

describe('OnePasswordProvider', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retrieves credentials via the op CLI', async () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      const ref = (args as string[])[1];
      if (ref === 'op://vault/item/username') {
        return Buffer.from('user@proton.me\n');
      }
      if (ref === 'op://vault/item/password') {
        return Buffer.from('bridge-password\n');
      }
      throw new Error(`unexpected ref: ${ref}`);
    });

    const provider = new OnePasswordProvider(
      'op://vault/item/username',
      'op://vault/item/password',
    );
    const credentials = await provider.getCredentials();

    expect(credentials.username).toBe('user@proton.me');
    expect(credentials.password).toBe('bridge-password');

    // Verify execFileSync was called with 'op' and ['read', ref] - not execSync
    expect(mockExecFileSync).toHaveBeenCalledWith('op', ['read', 'op://vault/item/username']);
    expect(mockExecFileSync).toHaveBeenCalledWith('op', ['read', 'op://vault/item/password']);
  });

  it('throws CredentialError when op CLI fails', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('op: command not found');
    });

    const provider = new OnePasswordProvider(
      'op://vault/item/username',
      'op://vault/item/password',
    );

    await expect(provider.getCredentials()).rejects.toBeInstanceOf(CredentialError);
  });

  it('trims whitespace from op CLI output', async () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      const ref = (args as string[])[1];
      if (ref === 'op://vault/item/username') {
        return Buffer.from('  user@proton.me  \n');
      }
      return Buffer.from('  bridge-password  \n');
    });

    const provider = new OnePasswordProvider(
      'op://vault/item/username',
      'op://vault/item/password',
    );
    const credentials = await provider.getCredentials();

    expect(credentials.username).toBe('user@proton.me');
    expect(credentials.password).toBe('bridge-password');
  });
});
