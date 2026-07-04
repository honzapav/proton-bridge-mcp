import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CredentialError } from '../../src/errors.js';

// Mock node:child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { KeychainProvider } from '../../src/credentials/keychain.js';

const mockExecFileSync = vi.mocked(execFileSync);

describe('KeychainProvider', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retrieves credentials via the security CLI', async () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      const service = (args as string[])[2];
      if (service === 'mcp.proton.email') {
        return Buffer.from('user@proton.me\n');
      }
      if (service === 'mcp.proton.password') {
        return Buffer.from('bridge-password\n');
      }
      throw new Error(`unexpected service: ${service}`);
    });

    const provider = new KeychainProvider('mcp.proton.email', 'mcp.proton.password');
    const credentials = await provider.getCredentials();

    expect(credentials.username).toBe('user@proton.me');
    expect(credentials.password).toBe('bridge-password');

    // Verify execFileSync was called with 'security' and the -s/-w args - not execSync
    expect(mockExecFileSync).toHaveBeenCalledWith('security', [
      'find-generic-password',
      '-s',
      'mcp.proton.email',
      '-w',
    ]);
    expect(mockExecFileSync).toHaveBeenCalledWith('security', [
      'find-generic-password',
      '-s',
      'mcp.proton.password',
      '-w',
    ]);
  });

  it('passes the account via -a when provided', async () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      const service = (args as string[])[2];
      if (service === 'mcp.proton.email') {
        return Buffer.from('user@proton.me\n');
      }
      return Buffer.from('bridge-password\n');
    });

    const provider = new KeychainProvider(
      'mcp.proton.email',
      'mcp.proton.password',
      'honza',
    );
    const credentials = await provider.getCredentials();

    expect(credentials.username).toBe('user@proton.me');
    expect(credentials.password).toBe('bridge-password');

    expect(mockExecFileSync).toHaveBeenCalledWith('security', [
      'find-generic-password',
      '-s',
      'mcp.proton.email',
      '-a',
      'honza',
      '-w',
    ]);
    expect(mockExecFileSync).toHaveBeenCalledWith('security', [
      'find-generic-password',
      '-s',
      'mcp.proton.password',
      '-a',
      'honza',
      '-w',
    ]);
  });

  it('throws CredentialError when the security CLI fails (item not found)', async () => {
    mockExecFileSync.mockImplementation(() => {
      // security exits with a non-zero code when the item does not exist;
      // execFileSync surfaces that as a thrown Error.
      throw new Error(
        'Command failed: security find-generic-password -s mcp.proton.email -w\n' +
          'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.',
      );
    });

    const provider = new KeychainProvider('mcp.proton.email', 'mcp.proton.password');

    await expect(provider.getCredentials()).rejects.toBeInstanceOf(CredentialError);
    await expect(provider.getCredentials()).rejects.toThrow(/macOS Keychain/);
  });

  it('trims whitespace from security CLI output', async () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      const service = (args as string[])[2];
      if (service === 'mcp.proton.email') {
        return Buffer.from('  user@proton.me  \n');
      }
      return Buffer.from('  bridge-password  \n');
    });

    const provider = new KeychainProvider('mcp.proton.email', 'mcp.proton.password');
    const credentials = await provider.getCredentials();

    expect(credentials.username).toBe('user@proton.me');
    expect(credentials.password).toBe('bridge-password');
  });
});
