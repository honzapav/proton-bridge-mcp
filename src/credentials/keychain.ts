import { execFileSync } from 'node:child_process';
import type { Credentials } from '../types.js';
import { CredentialError } from '../errors.js';
import type { CredentialProvider } from './provider.js';

/**
 * Reads credentials from the macOS Keychain using the security CLI.
 *
 * Each credential is stored as a generic password item, looked up by its
 * service name: security find-generic-password -s <service> [-a <account>] -w
 *
 * Uses execFileSync (not execSync) to prevent shell injection.
 * Each service name is passed directly as an argument to the security binary.
 */
export class KeychainProvider implements CredentialProvider {
  private readonly usernameService: string;
  private readonly passwordService: string;
  private readonly account?: string;

  constructor(usernameService: string, passwordService: string, account?: string) {
    this.usernameService = usernameService;
    this.passwordService = passwordService;
    this.account = account;
  }

  private readItem(service: string): string {
    const args = ['find-generic-password', '-s', service];
    if (this.account !== undefined) {
      args.push('-a', this.account);
    }
    args.push('-w');
    return execFileSync('security', args).toString().trim();
  }

  async getCredentials(): Promise<Credentials> {
    try {
      const username = this.readItem(this.usernameService);
      const password = this.readItem(this.passwordService);
      return { username, password };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CredentialError(
        `Failed to read credentials from macOS Keychain: ${message}`,
        [
          'Ensure the keychain items exist: security add-generic-password -s <service> -a <account> -w <secret>.',
          'Verify KEYCHAIN_USERNAME_SERVICE and KEYCHAIN_PASSWORD_SERVICE match the service names of the items.',
          'If KEYCHAIN_ACCOUNT is set, it must match the account (-a) of the keychain items.',
          'The keychain must be unlocked; run "security unlock-keychain" if needed.',
        ],
      );
    }
  }
}
