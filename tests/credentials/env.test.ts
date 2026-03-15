import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvCredentialProvider } from '../../src/credentials/env.js';
import { CredentialError } from '../../src/errors.js';

const USERNAME_VAR = 'PROTON_BRIDGE_USERNAME';
const PASSWORD_VAR = 'PROTON_BRIDGE_PASSWORD';

function clearEnv() {
  delete process.env[USERNAME_VAR];
  delete process.env[PASSWORD_VAR];
}

describe('EnvCredentialProvider', () => {
  beforeEach(() => {
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  it('reads credentials from environment variables', async () => {
    process.env[USERNAME_VAR] = 'testuser@proton.me';
    process.env[PASSWORD_VAR] = 'bridge-secret-password';

    const provider = new EnvCredentialProvider();
    const credentials = await provider.getCredentials();

    expect(credentials.username).toBe('testuser@proton.me');
    expect(credentials.password).toBe('bridge-secret-password');
  });

  it('throws CredentialError when username is missing', async () => {
    process.env[PASSWORD_VAR] = 'bridge-secret-password';

    const provider = new EnvCredentialProvider();

    await expect(provider.getCredentials()).rejects.toBeInstanceOf(CredentialError);
  });

  it('throws CredentialError when password is missing', async () => {
    process.env[USERNAME_VAR] = 'testuser@proton.me';

    const provider = new EnvCredentialProvider();

    await expect(provider.getCredentials()).rejects.toBeInstanceOf(CredentialError);
  });
});
