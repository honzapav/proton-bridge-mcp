import { execFileSync } from 'node:child_process';
import type { Credentials } from '../types.js';
import { CredentialError } from '../errors.js';
import type { CredentialProvider } from './provider.js';

/**
 * Reads credentials from 1Password using the op CLI.
 *
 * Uses execFileSync (not execSync) to prevent shell injection.
 * Each ref is passed directly as an argument to the op binary.
 */
export class OnePasswordProvider implements CredentialProvider {
  private readonly usernameRef: string;
  private readonly passwordRef: string;

  constructor(usernameRef: string, passwordRef: string) {
    this.usernameRef = usernameRef;
    this.passwordRef = passwordRef;
  }

  async getCredentials(): Promise<Credentials> {
    try {
      const username = execFileSync('op', ['read', this.usernameRef]).toString().trim();
      const password = execFileSync('op', ['read', this.passwordRef]).toString().trim();
      return { username, password };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CredentialError(
        `Failed to read credentials from 1Password: ${message}`,
        [
          'Ensure the op CLI is installed and authenticated (run "op signin").',
          'Verify the secret references are correct (format: op://vault/item/field).',
          'Check that OP_USERNAME_REF and OP_PASSWORD_REF point to valid 1Password items.',
        ],
      );
    }
  }
}
