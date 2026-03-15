import { z } from 'zod';
import fs from 'node:fs';

// Schema for credential provider configuration
const CredentialsConfigSchema = z.object({
  provider: z.enum(['env', 'onepassword', 'protonpass']).default('env'),
  onepassword: z
    .object({
      username_ref: z.string(),
      password_ref: z.string(),
    })
    .optional(),
  protonpass: z
    .object({
      username_ref: z.string(),
      password_ref: z.string(),
    })
    .optional(),
});

// Schema for IMAP connection configuration
const ImapConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(1143),
  poolSize: z.number().int().min(1).max(10).default(3),
  commandTimeout: z.number().int().positive().default(30000),
  acquireTimeout: z.number().int().positive().default(10000),
  idleTimeout: z.number().int().positive().default(300000),
});

// Schema for SMTP connection configuration
const SmtpConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(1025),
});

// Top-level config schema
// Note: zod v4 does not propagate inner field defaults when a parent .default({})
// is used, so we supply explicit full default objects here.
const ConfigSchema = z.object({
  credentials: CredentialsConfigSchema.default({ provider: 'env' }),
  imap: ImapConfigSchema.default({
    host: '127.0.0.1',
    port: 1143,
    poolSize: 3,
    commandTimeout: 30000,
    acquireTimeout: 10000,
    idleTimeout: 300000,
  }),
  smtp: SmtpConfigSchema.default({ host: '127.0.0.1', port: 1025 }),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Read and parse a JSON config file. Returns an empty object if the file does
 * not exist or cannot be read.
 */
function loadConfigFile(filePath?: string): Record<string, unknown> {
  const target = filePath ?? process.env.PROTON_BRIDGE_CONFIG ?? './config.json';

  try {
    const raw = fs.readFileSync(target, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File not found or unreadable - silently fall back to defaults
    return {};
  }
}

/**
 * Merge environment variable overrides on top of a parsed config object.
 * Returns a new object; does not mutate the input.
 *
 * Resolution order: env vars > config file > schema defaults.
 */
function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(config) as {
    credentials?: Record<string, unknown>;
    imap?: Record<string, unknown>;
    smtp?: Record<string, unknown>;
  };

  // IMAP overrides
  if (process.env.PROTON_BRIDGE_IMAP_HOST !== undefined) {
    result.imap = result.imap ?? {};
    result.imap.host = process.env.PROTON_BRIDGE_IMAP_HOST;
  }
  if (process.env.PROTON_BRIDGE_IMAP_PORT !== undefined) {
    result.imap = result.imap ?? {};
    result.imap.port = Number(process.env.PROTON_BRIDGE_IMAP_PORT);
  }

  // SMTP overrides
  if (process.env.PROTON_BRIDGE_SMTP_HOST !== undefined) {
    result.smtp = result.smtp ?? {};
    result.smtp.host = process.env.PROTON_BRIDGE_SMTP_HOST;
  }
  if (process.env.PROTON_BRIDGE_SMTP_PORT !== undefined) {
    result.smtp = result.smtp ?? {};
    result.smtp.port = Number(process.env.PROTON_BRIDGE_SMTP_PORT);
  }

  // Credential provider overrides
  if (process.env.CREDENTIAL_PROVIDER !== undefined) {
    result.credentials = result.credentials ?? {};
    result.credentials.provider = process.env.CREDENTIAL_PROVIDER;
  }
  if (
    process.env.OP_USERNAME_REF !== undefined ||
    process.env.OP_PASSWORD_REF !== undefined
  ) {
    result.credentials = result.credentials ?? {};
    const existing = (result.credentials.onepassword ?? {}) as Record<string, unknown>;
    if (process.env.OP_USERNAME_REF !== undefined) {
      existing.username_ref = process.env.OP_USERNAME_REF;
    }
    if (process.env.OP_PASSWORD_REF !== undefined) {
      existing.password_ref = process.env.OP_PASSWORD_REF;
    }
    result.credentials.onepassword = existing;
  }
  if (
    process.env.PP_USERNAME_REF !== undefined ||
    process.env.PP_PASSWORD_REF !== undefined
  ) {
    result.credentials = result.credentials ?? {};
    const existing = (result.credentials.protonpass ?? {}) as Record<string, unknown>;
    if (process.env.PP_USERNAME_REF !== undefined) {
      existing.username_ref = process.env.PP_USERNAME_REF;
    }
    if (process.env.PP_PASSWORD_REF !== undefined) {
      existing.password_ref = process.env.PP_PASSWORD_REF;
    }
    result.credentials.protonpass = existing;
  }

  return result;
}

/**
 * Load, validate and return the server configuration.
 *
 * @param fileOverride - Optional path to a config file; overrides the
 *   PROTON_BRIDGE_CONFIG env var and the default ./config.json location.
 *   Primarily used for testing.
 */
export function loadConfig(fileOverride?: string): Config {
  const fromFile = loadConfigFile(fileOverride);
  const withEnv = applyEnvOverrides(fromFile);
  return ConfigSchema.parse(withEnv);
}
