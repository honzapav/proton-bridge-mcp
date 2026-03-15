import { execFileSync } from 'node:child_process';
import type { Credentials } from '../types.js';
import { CredentialError } from '../errors.js';
import type { CredentialProvider } from './provider.js';

/**
 * Reads credentials from Proton Pass using the pass-cli CLI.
 *
 * Uses execFileSync (not execSync) to prevent shell injection.
 * Each ref is passed directly as an argument to the pass-cli binary.
 */
export class ProtonPassProvider implements CredentialProvider {
  private readonly usernameRef: string;
  private readonly passwordRef: string;

  constructor(usernameRef: string, passwordRef: string) {
    this.usernameRef = usernameRef;
    this.passwordRef = passwordRef;
  }

  async getCredentials(): Promise<Credentials> {
    try {
      const username = execFileSync('pass-cli', ['item', 'view', this.usernameRef])
        .toString()
        .trim();
      const password = execFileSync('pass-cli', ['item', 'view', this.passwordRef])
        .toString()
        .trim();
      return { username, password };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CredentialError(
        `Failed to read credentials from Proton Pass: ${message}`,
        [
          'Ensure the pass-cli tool is installed and authenticated.',
          'Verify the item references are correct (e.g. "proton/bridge/username").',
          'Check that PP_USERNAME_REF and PP_PASSWORD_REF point to valid Proton Pass items.',
        ],
      );
    }
  }
}
