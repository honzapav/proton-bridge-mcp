import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CredentialError } from '../../src/errors.js';

// Mock node:child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { ProtonPassProvider } from '../../src/credentials/protonpass.js';

const mockExecFileSync = vi.mocked(execFileSync);

describe('ProtonPassProvider', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retrieves credentials via the pass-cli CLI', async () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      const ref = (args as string[])[2];
      if (ref === 'proton/bridge/username') {
        return Buffer.from('user@proton.me\n');
      }
      if (ref === 'proton/bridge/password') {
        return Buffer.from('bridge-password\n');
      }
      throw new Error(`unexpected ref: ${ref}`);
    });

    const provider = new ProtonPassProvider(
      'proton/bridge/username',
      'proton/bridge/password',
    );
    const credentials = await provider.getCredentials();

    expect(credentials.username).toBe('user@proton.me');
    expect(credentials.password).toBe('bridge-password');

    // Verify execFileSync was called with 'pass-cli' and ['item', 'view', ref]
    expect(mockExecFileSync).toHaveBeenCalledWith('pass-cli', ['item', 'view', 'proton/bridge/username']);
    expect(mockExecFileSync).toHaveBeenCalledWith('pass-cli', ['item', 'view', 'proton/bridge/password']);
  });

  it('throws CredentialError when pass-cli fails', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('pass-cli: command not found');
    });

    const provider = new ProtonPassProvider(
      'proton/bridge/username',
      'proton/bridge/password',
    );

    await expect(provider.getCredentials()).rejects.toBeInstanceOf(CredentialError);
  });

  it('trims whitespace from pass-cli output', async () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      const ref = (args as string[])[2];
      if (ref === 'proton/bridge/username') {
        return Buffer.from('  user@proton.me  \n');
      }
      return Buffer.from('  bridge-password  \n');
    });

    const provider = new ProtonPassProvider(
      'proton/bridge/username',
      'proton/bridge/password',
    );
    const credentials = await provider.getCredentials();

    expect(credentials.username).toBe('user@proton.me');
    expect(credentials.password).toBe('bridge-password');
  });
});
