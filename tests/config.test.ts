import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper to clear relevant env vars before each test
const ENV_VARS = [
  'PROTON_BRIDGE_CONFIG',
  'PROTON_BRIDGE_IMAP_HOST',
  'PROTON_BRIDGE_IMAP_PORT',
  'PROTON_BRIDGE_SMTP_HOST',
  'PROTON_BRIDGE_SMTP_PORT',
  'CREDENTIAL_PROVIDER',
  'OP_USERNAME_REF',
  'OP_PASSWORD_REF',
  'PP_USERNAME_REF',
  'PP_PASSWORD_REF',
];

function clearEnv() {
  for (const key of ENV_VARS) {
    delete process.env[key];
  }
}

describe('loadConfig', () => {
  beforeEach(() => {
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  it('returns defaults when no env vars or config file', () => {
    // Pass a non-existent file path so no config file is loaded
    const config = loadConfig('/nonexistent/path/config.json');

    expect(config.credentials.provider).toBe('env');
    expect(config.imap.host).toBe('127.0.0.1');
    expect(config.imap.port).toBe(1143);
    expect(config.imap.poolSize).toBe(3);
    expect(config.imap.commandTimeout).toBe(30000);
    expect(config.imap.acquireTimeout).toBe(10000);
    expect(config.imap.idleTimeout).toBe(300000);
    expect(config.smtp.host).toBe('127.0.0.1');
    expect(config.smtp.port).toBe(1025);
  });

  it('env vars override defaults', () => {
    process.env.PROTON_BRIDGE_IMAP_HOST = '192.168.1.10';
    process.env.PROTON_BRIDGE_IMAP_PORT = '2143';
    process.env.PROTON_BRIDGE_SMTP_HOST = '192.168.1.10';
    process.env.PROTON_BRIDGE_SMTP_PORT = '2025';
    process.env.CREDENTIAL_PROVIDER = 'onepassword';
    process.env.OP_USERNAME_REF = 'op://vault/item/username';
    process.env.OP_PASSWORD_REF = 'op://vault/item/password';

    const config = loadConfig('/nonexistent/path/config.json');

    expect(config.imap.host).toBe('192.168.1.10');
    expect(config.imap.port).toBe(2143);
    expect(config.smtp.host).toBe('192.168.1.10');
    expect(config.smtp.port).toBe(2025);
    expect(config.credentials.provider).toBe('onepassword');
    expect(config.credentials.onepassword?.username_ref).toBe('op://vault/item/username');
    expect(config.credentials.onepassword?.password_ref).toBe('op://vault/item/password');
  });

  it('env vars override config file values', () => {
    // Use a fixture config file
    const fixturePath = path.join(__dirname, 'fixtures', 'config.fixture.json');

    process.env.PROTON_BRIDGE_IMAP_HOST = 'env-host';
    process.env.PROTON_BRIDGE_IMAP_PORT = '9143';

    const config = loadConfig(fixturePath);

    // Env var should win over file value
    expect(config.imap.host).toBe('env-host');
    expect(config.imap.port).toBe(9143);
    // Non-overridden value should come from file
    expect(config.imap.poolSize).toBe(5);
  });

  it('validates poolSize max - throws when poolSize exceeds 10', () => {
    // Pass a fixture with poolSize: 50
    const fixturePath = path.join(__dirname, 'fixtures', 'config.invalid.json');

    expect(() => loadConfig(fixturePath)).toThrow();
  });
});
