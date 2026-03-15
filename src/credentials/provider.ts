import type { Credentials } from '../types.js';
import type { Config } from '../config.js';
import { EnvCredentialProvider } from './env.js';
import { OnePasswordProvider } from './onepassword.js';
import { ProtonPassProvider } from './protonpass.js';

export interface CredentialProvider {
  getCredentials(): Promise<Credentials>;
}

/**
 * Factory that returns the appropriate CredentialProvider based on the config.
 */
export function createCredentialProvider(config: Config): CredentialProvider {
  const { provider } = config.credentials;

  if (provider === 'onepassword') {
    const op = config.credentials.onepassword;
    if (!op) {
      throw new Error(
        'Credential provider is "onepassword" but no onepassword config section found.',
      );
    }
    return new OnePasswordProvider(op.username_ref, op.password_ref);
  }

  if (provider === 'protonpass') {
    const pp = config.credentials.protonpass;
    if (!pp) {
      throw new Error(
        'Credential provider is "protonpass" but no protonpass config section found.',
      );
    }
    return new ProtonPassProvider(pp.username_ref, pp.password_ref);
  }

  return new EnvCredentialProvider();
}
