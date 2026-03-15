# Proton Bridge MCP Server Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local MCP server that connects to Proton Bridge via IMAP for email reading, draft management, and inbox organization with pluggable credential providers.

**Architecture:** Four-layer architecture (Credential Provider -> Connection Manager -> Services -> MCP Tools). All layers communicate through TypeScript interfaces. IMAP connection pool manages lifecycle. Services encapsulate business logic. MCP tools are thin Zod-validated wrappers.

**Tech Stack:** TypeScript, Node.js (ES modules), `@modelcontextprotocol/sdk`, `imapflow`, `nodemailer` (MailComposer), `postal-mime`, `zod`, `vitest`

**Spec:** `docs/superpowers/specs/2026-03-15-proton-bridge-mcp-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, scripts, type:module |
| `tsconfig.json` | TypeScript config, ES2022, Node16 modules |
| `config.example.json` | Example configuration |
| `src/types.ts` | Shared type definitions (EmailMeta, Email, Folder, etc.) |
| `src/errors.ts` | Error hierarchy (ProtonBridgeError + subtypes) |
| `src/config.ts` | Zod config schema, env/file/defaults resolution |
| `src/credentials/provider.ts` | CredentialProvider interface + factory |
| `src/credentials/env.ts` | EnvCredentialProvider |
| `src/credentials/onepassword.ts` | OnePasswordProvider |
| `src/credentials/protonpass.ts` | ProtonPassProvider |
| `src/connection/imap-pool.ts` | IMAP connection pool |
| `src/services/message.service.ts` | List, get, search, headers, unread count |
| `src/services/mailbox.service.ts` | Folders & labels CRUD |
| `src/services/organize.service.ts` | Move, flags, labels |
| `src/services/draft.service.ts` | Save, list, update drafts |
| `src/tools/reading.ts` | Reading tool definitions |
| `src/tools/composing.ts` | Draft tool definitions |
| `src/tools/organizing.ts` | Organizing tool definitions |
| `src/tools/mailbox.ts` | Mailbox management tool definitions |
| `src/tools/connection.ts` | Connection status tool |
| `src/index.ts` | Server bootstrap, wiring |
| `tests/config.test.ts` | Config validation tests |
| `tests/credentials/env.test.ts` | Env provider tests |
| `tests/credentials/onepassword.test.ts` | 1Password provider tests |
| `tests/credentials/protonpass.test.ts` | ProtonPass provider tests |
| `tests/connection/imap-pool.test.ts` | Connection pool tests |
| `tests/services/message.test.ts` | MessageService tests |
| `tests/services/mailbox.test.ts` | MailboxService tests |
| `tests/services/organize.test.ts` | OrganizeService tests |
| `tests/services/draft.test.ts` | DraftService tests |

---

## Chunk 1: Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize project**

```bash
cd /Users/honzapav/Dev/projekty/proton-bridge-mcp
npm init -y
```

- [ ] **Step 2: Configure package.json**

Set `"type": "module"` and add scripts. Write `package.json`:

```json
{
  "name": "proton-bridge-mcp",
  "version": "0.1.0",
  "description": "MCP server for Proton Bridge email access",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "proton-bridge-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": ["mcp", "protonmail", "proton-bridge", "email"],
  "license": "MIT"
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk zod imapflow nodemailer postal-mime
npm install -D typescript @types/node @types/nodemailer vitest
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
config.json
.env
*.tgz
```

- [ ] **Step 6: Verify build compiles (empty project)**

Create `src/index.ts` with just `console.log('proton-bridge-mcp');` and run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore src/index.ts package-lock.json
git commit -m "chore: scaffold project with dependencies"
```

---

### Task 2: Types & Error Hierarchy

**Files:**
- Create: `src/types.ts`
- Create: `src/errors.ts`

- [ ] **Step 1: Write types.ts**

All shared type definitions used across layers:

```typescript
// src/types.ts

export interface Credentials {
  username: string;
  password: string;
}

export interface EmailAddress {
  name: string;
  address: string;
}

export interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}

export interface AttachmentContent extends AttachmentMeta {
  content: string; // base64 encoded
}

export interface EmailMeta {
  uid: number;
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string; // ISO string
  flags: string[];
  hasAttachments: boolean;
  messageId?: string;
}

export interface Email extends EmailMeta {
  textBody: string;
  htmlBody: string;
  headers: EmailHeaders;
  attachments: AttachmentMeta[] | AttachmentContent[];
}

export interface EmailHeaders {
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
}

export interface Folder {
  path: string;
  name: string;
  delimiter: string;
  specialUse?: string;
  type: 'system' | 'folder' | 'label';
  flags: string[];
}

export interface DraftInput {
  to: string[];
  subject: string;
  body: string;
  html?: string;
  from?: string;
  cc?: string[];
  bcc?: string[];
  inReplyTo?: string;
  references?: string[];
  attachments?: Array<{
    filename: string;
    content_base64: string;
    content_type: string;
  }>;
}

export interface SearchCriteria {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  since?: string;
  before?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
}

export interface PoolStats {
  total: number;
  inUse: number;
  available: number;
  waiting: number;
}

export interface ConnectionStatus {
  imap: {
    connected: boolean;
    pool: PoolStats;
    lastError?: string;
  };
}
```

- [ ] **Step 2: Write errors.ts**

```typescript
// src/errors.ts

export enum ErrorType {
  CONNECTION = 'connection',
  AUTH = 'auth',
  MAILBOX = 'mailbox',
  CREDENTIAL = 'credential',
  VALIDATION = 'validation',
}

export class ProtonBridgeError extends Error {
  type: ErrorType;
  suggestions: string[];

  constructor(type: ErrorType, message: string, suggestions: string[] = []) {
    super(message);
    this.name = 'ProtonBridgeError';
    this.type = type;
    this.suggestions = suggestions;
  }
}

export class ConnectionError extends ProtonBridgeError {
  constructor(message: string) {
    super(ErrorType.CONNECTION, message, [
      'Ensure Proton Bridge is running',
      'Check IMAP port (default 1143)',
    ]);
  }
}

export class AuthError extends ProtonBridgeError {
  constructor(message: string) {
    super(ErrorType.AUTH, message, [
      'Check Bridge password (not your Proton account password)',
      'Regenerate Bridge password in Bridge app',
    ]);
  }
}

export class MailboxError extends ProtonBridgeError {
  constructor(message: string) {
    super(ErrorType.MAILBOX, message, [
      'Run list_folders to see available folders',
    ]);
  }
}

export class CredentialError extends ProtonBridgeError {
  constructor(message: string, provider?: string) {
    const suggestions = provider === 'onepassword'
      ? ['Ensure 1Password CLI (op) is installed', 'Run "op signin" or enable biometric unlock']
      : provider === 'protonpass'
        ? ['Ensure ProtonPass CLI (pass-cli) is installed', 'Set PROTON_PASS_PASSWORD env var']
        : ['Set PROTON_BRIDGE_USERNAME and PROTON_BRIDGE_PASSWORD env vars'];
    super(ErrorType.CREDENTIAL, message, suggestions);
  }
}

export function classifyError(err: unknown): ProtonBridgeError {
  if (err instanceof ProtonBridgeError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT')) {
    return new ConnectionError(message);
  }
  if (message.includes('auth') || message.includes('AUTH') || message.includes('Invalid credentials')) {
    return new AuthError(message);
  }
  if (message.includes('NONEXISTENT') || message.includes('Mailbox not found')) {
    return new MailboxError(message);
  }
  return new ProtonBridgeError(ErrorType.CONNECTION, message, []);
}

export function errorToToolResponse(err: unknown, tool?: string) {
  const classified = classifyError(err);
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: true,
        errorType: classified.type,
        message: classified.message,
        ...(tool && { tool }),
        suggestions: classified.suggestions,
      }),
    }],
    isError: true,
  };
}
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/errors.ts
git commit -m "feat: add shared types and error hierarchy"
```

---

### Task 3: Configuration

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`
- Create: `config.example.json`

- [ ] **Step 1: Write failing config tests**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns defaults when no env vars or config file', () => {
    delete process.env.PROTON_BRIDGE_USERNAME;
    delete process.env.PROTON_BRIDGE_PASSWORD;
    delete process.env.PROTON_BRIDGE_CONFIG;
    const config = loadConfig();
    expect(config.imap.host).toBe('127.0.0.1');
    expect(config.imap.port).toBe(1143);
    expect(config.imap.poolSize).toBe(3);
    expect(config.credentials.provider).toBe('env');
  });

  it('env vars override defaults', () => {
    process.env.PROTON_BRIDGE_IMAP_PORT = '2143';
    process.env.CREDENTIAL_PROVIDER = 'onepassword';
    const config = loadConfig();
    expect(config.imap.port).toBe(2143);
    expect(config.credentials.provider).toBe('onepassword');
  });

  it('env vars override config file values', () => {
    process.env.PROTON_BRIDGE_IMAP_PORT = '9999';
    const config = loadConfig({ imap: { port: 1143 } });
    expect(config.imap.port).toBe(9999);
  });

  it('validates poolSize max', () => {
    const config = loadConfig({ imap: { poolSize: 50 } });
    expect(config.imap.poolSize).toBe(10); // clamped to max
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write config.ts**

```typescript
// src/config.ts
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';

const CredentialsConfigSchema = z.object({
  provider: z.enum(['env', 'onepassword', 'protonpass']).default('env'),
  onepassword: z.object({
    username_ref: z.string(),
    password_ref: z.string(),
  }).optional(),
  protonpass: z.object({
    username_ref: z.string(),
    password_ref: z.string(),
  }).optional(),
});

const ImapConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(1143),
  poolSize: z.number().int().min(1).max(10).default(3),
  commandTimeout: z.number().int().min(1000).default(30000),
  acquireTimeout: z.number().int().min(1000).default(10000),
  idleTimeout: z.number().int().min(1000).default(300000),
});

const SmtpConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(1025),
});

const ConfigSchema = z.object({
  credentials: CredentialsConfigSchema.default({}),
  imap: ImapConfigSchema.default({}),
  smtp: SmtpConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfigFile(): Record<string, unknown> | null {
  const configPath = process.env.PROTON_BRIDGE_CONFIG;
  if (configPath && existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  if (existsSync('config.json')) {
    return JSON.parse(readFileSync('config.json', 'utf-8'));
  }
  return null;
}

function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(config);

  const imap = (result.imap ?? {}) as Record<string, unknown>;
  const smtp = (result.smtp ?? {}) as Record<string, unknown>;
  const credentials = (result.credentials ?? {}) as Record<string, unknown>;

  if (process.env.PROTON_BRIDGE_IMAP_HOST) imap.host = process.env.PROTON_BRIDGE_IMAP_HOST;
  if (process.env.PROTON_BRIDGE_IMAP_PORT) imap.port = parseInt(process.env.PROTON_BRIDGE_IMAP_PORT, 10);
  if (process.env.PROTON_BRIDGE_SMTP_HOST) smtp.host = process.env.PROTON_BRIDGE_SMTP_HOST;
  if (process.env.PROTON_BRIDGE_SMTP_PORT) smtp.port = parseInt(process.env.PROTON_BRIDGE_SMTP_PORT, 10);
  if (process.env.CREDENTIAL_PROVIDER) credentials.provider = process.env.CREDENTIAL_PROVIDER;

  if (process.env.OP_USERNAME_REF || process.env.OP_PASSWORD_REF) {
    credentials.onepassword = {
      username_ref: process.env.OP_USERNAME_REF ?? '',
      password_ref: process.env.OP_PASSWORD_REF ?? '',
    };
  }

  if (process.env.PP_USERNAME_REF || process.env.PP_PASSWORD_REF) {
    credentials.protonpass = {
      username_ref: process.env.PP_USERNAME_REF ?? '',
      password_ref: process.env.PP_PASSWORD_REF ?? '',
    };
  }

  result.imap = imap;
  result.smtp = smtp;
  result.credentials = credentials;

  return result;
}

export function loadConfig(fileOverride?: Record<string, unknown>): Config {
  const fileConfig = fileOverride ?? loadConfigFile() ?? {};
  const merged = applyEnvOverrides(fileConfig);
  return ConfigSchema.parse(merged);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/config.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Create config.example.json**

```json
{
  "credentials": {
    "provider": "env",
    "onepassword": {
      "username_ref": "op://Private/ProtonBridge/username",
      "password_ref": "op://Private/ProtonBridge/password"
    },
    "protonpass": {
      "username_ref": "pass://Personal/ProtonBridge/username",
      "password_ref": "pass://Personal/ProtonBridge/password"
    }
  },
  "imap": {
    "host": "127.0.0.1",
    "port": 1143,
    "poolSize": 3,
    "commandTimeout": 30000,
    "acquireTimeout": 10000,
    "idleTimeout": 300000
  },
  "smtp": {
    "host": "127.0.0.1",
    "port": 1025
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts config.example.json
git commit -m "feat: add Zod-validated config with env override precedence"
```

---

### Task 4: Credential Providers

**Files:**
- Create: `src/credentials/provider.ts`
- Create: `src/credentials/env.ts`
- Create: `src/credentials/onepassword.ts`
- Create: `src/credentials/protonpass.ts`
- Create: `tests/credentials/env.test.ts`
- Create: `tests/credentials/onepassword.test.ts`
- Create: `tests/credentials/protonpass.test.ts`

**SECURITY NOTE:** All credential providers that shell out to CLI tools MUST use `execFileSync` (not `execSync`) to prevent shell injection. `execFileSync` passes arguments as an array without going through a shell.

- [ ] **Step 1: Write provider interface and factory**

```typescript
// src/credentials/provider.ts
import type { Credentials } from '../types.js';
import type { Config } from '../config.js';
import { EnvCredentialProvider } from './env.js';
import { OnePasswordProvider } from './onepassword.js';
import { ProtonPassProvider } from './protonpass.js';

export interface CredentialProvider {
  getCredentials(): Promise<Credentials>;
}

export function createCredentialProvider(config: Config): CredentialProvider {
  switch (config.credentials.provider) {
    case 'onepassword': {
      const opConfig = config.credentials.onepassword;
      if (!opConfig) throw new Error('Missing onepassword config (username_ref, password_ref)');
      return new OnePasswordProvider(opConfig.username_ref, opConfig.password_ref);
    }
    case 'protonpass': {
      const ppConfig = config.credentials.protonpass;
      if (!ppConfig) throw new Error('Missing protonpass config (username_ref, password_ref)');
      return new ProtonPassProvider(ppConfig.username_ref, ppConfig.password_ref);
    }
    case 'env':
    default:
      return new EnvCredentialProvider();
  }
}
```

- [ ] **Step 2: Write failing env provider test**

```typescript
// tests/credentials/env.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvCredentialProvider } from '../../src/credentials/env.js';

describe('EnvCredentialProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reads credentials from env vars', async () => {
    process.env.PROTON_BRIDGE_USERNAME = 'test@proton.me';
    process.env.PROTON_BRIDGE_PASSWORD = 'bridge-pass-123';
    const provider = new EnvCredentialProvider();
    const creds = await provider.getCredentials();
    expect(creds.username).toBe('test@proton.me');
    expect(creds.password).toBe('bridge-pass-123');
  });

  it('throws when username is missing', async () => {
    delete process.env.PROTON_BRIDGE_USERNAME;
    process.env.PROTON_BRIDGE_PASSWORD = 'pass';
    const provider = new EnvCredentialProvider();
    await expect(provider.getCredentials()).rejects.toThrow('PROTON_BRIDGE_USERNAME');
  });

  it('throws when password is missing', async () => {
    process.env.PROTON_BRIDGE_USERNAME = 'user';
    delete process.env.PROTON_BRIDGE_PASSWORD;
    const provider = new EnvCredentialProvider();
    await expect(provider.getCredentials()).rejects.toThrow('PROTON_BRIDGE_PASSWORD');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/credentials/env.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement env provider**

```typescript
// src/credentials/env.ts
import type { CredentialProvider } from './provider.js';
import type { Credentials } from '../types.js';
import { CredentialError } from '../errors.js';

export class EnvCredentialProvider implements CredentialProvider {
  async getCredentials(): Promise<Credentials> {
    const username = process.env.PROTON_BRIDGE_USERNAME;
    const password = process.env.PROTON_BRIDGE_PASSWORD;
    if (!username) {
      throw new CredentialError('PROTON_BRIDGE_USERNAME environment variable is not set');
    }
    if (!password) {
      throw new CredentialError('PROTON_BRIDGE_PASSWORD environment variable is not set');
    }
    return { username, password };
  }
}
```

- [ ] **Step 5: Run env tests to verify they pass**

```bash
npx vitest run tests/credentials/env.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 6: Write failing 1Password provider test**

```typescript
// tests/credentials/onepassword.test.ts
import { describe, it, expect, vi } from 'vitest';
import { OnePasswordProvider } from '../../src/credentials/onepassword.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    const ref = args[1]; // 'op' 'read' '<ref>'
    if (ref === 'op://vault/item/username') return Buffer.from('user@proton.me\n');
    if (ref === 'op://vault/item/password') return Buffer.from('bridge-pass\n');
    throw new Error(`Unknown ref: ${ref}`);
  }),
}));

describe('OnePasswordProvider', () => {
  it('retrieves credentials via op CLI using execFileSync', async () => {
    const provider = new OnePasswordProvider(
      'op://vault/item/username',
      'op://vault/item/password',
    );
    const creds = await provider.getCredentials();
    expect(creds.username).toBe('user@proton.me');
    expect(creds.password).toBe('bridge-pass');
  });
});
```

- [ ] **Step 7: Implement 1Password provider**

```typescript
// src/credentials/onepassword.ts
import { execFileSync } from 'node:child_process';
import type { CredentialProvider } from './provider.js';
import type { Credentials } from '../types.js';
import { CredentialError } from '../errors.js';

export class OnePasswordProvider implements CredentialProvider {
  constructor(
    private usernameRef: string,
    private passwordRef: string,
  ) {}

  async getCredentials(): Promise<Credentials> {
    try {
      const username = execFileSync('op', ['read', this.usernameRef], {
        encoding: 'utf-8',
        timeout: 30000,
      }).trim();
      const password = execFileSync('op', ['read', this.passwordRef], {
        encoding: 'utf-8',
        timeout: 30000,
      }).trim();
      return { username, password };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CredentialError(
        `Failed to read credentials from 1Password: ${message}`,
        'onepassword',
      );
    }
  }
}
```

- [ ] **Step 8: Write failing ProtonPass provider test**

```typescript
// tests/credentials/protonpass.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ProtonPassProvider } from '../../src/credentials/protonpass.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    // 'pass-cli' 'item' 'view' '<ref>'
    const ref = args[2];
    if (ref === 'pass://vault/item/username') return Buffer.from('user@proton.me\n');
    if (ref === 'pass://vault/item/password') return Buffer.from('bridge-pass\n');
    throw new Error(`Unknown ref: ${ref}`);
  }),
}));

describe('ProtonPassProvider', () => {
  it('retrieves credentials via pass-cli using execFileSync', async () => {
    const provider = new ProtonPassProvider(
      'pass://vault/item/username',
      'pass://vault/item/password',
    );
    const creds = await provider.getCredentials();
    expect(creds.username).toBe('user@proton.me');
    expect(creds.password).toBe('bridge-pass');
  });
});
```

- [ ] **Step 9: Implement ProtonPass provider**

```typescript
// src/credentials/protonpass.ts
import { execFileSync } from 'node:child_process';
import type { CredentialProvider } from './provider.js';
import type { Credentials } from '../types.js';
import { CredentialError } from '../errors.js';

export class ProtonPassProvider implements CredentialProvider {
  constructor(
    private usernameRef: string,
    private passwordRef: string,
  ) {}

  async getCredentials(): Promise<Credentials> {
    try {
      const username = execFileSync(
        'pass-cli',
        ['item', 'view', this.usernameRef],
        { encoding: 'utf-8', timeout: 30000 },
      ).trim();
      const password = execFileSync(
        'pass-cli',
        ['item', 'view', this.passwordRef],
        { encoding: 'utf-8', timeout: 30000 },
      ).trim();
      return { username, password };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CredentialError(
        `Failed to read credentials from ProtonPass: ${message}`,
        'protonpass',
      );
    }
  }
}
```

- [ ] **Step 10: Run all credential tests**

```bash
npx vitest run tests/credentials/
```

Expected: all tests PASS.

- [ ] **Step 11: Verify full build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/credentials/ tests/credentials/
git commit -m "feat: add pluggable credential providers (env, 1password, protonpass)"
```

---

## Chunk 2: Connection & Services

### Task 5: IMAP Connection Pool

**Files:**
- Create: `src/connection/imap-pool.ts`
- Create: `tests/connection/imap-pool.test.ts`

- [ ] **Step 1: Write failing connection pool tests**

```typescript
// tests/connection/imap-pool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapPool } from '../../src/connection/imap-pool.js';

// Mock ImapFlow
const mockClient = {
  connect: vi.fn(),
  logout: vi.fn(),
  close: vi.fn(),
  getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
  usable: true,
  on: vi.fn(),
};

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({ ...mockClient })),
}));

describe('ImapPool', () => {
  let pool: ImapPool;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new ImapPool({
      host: '127.0.0.1',
      port: 1143,
      auth: { user: 'test', pass: 'test' },
      poolSize: 2,
      acquireTimeout: 5000,
      commandTimeout: 30000,
      idleTimeout: 300000,
    });
  });

  it('creates a connection on acquire', async () => {
    const client = await pool.acquire();
    expect(client).toBeDefined();
    expect(client.connect).toHaveBeenCalled();
    pool.release(client);
  });

  it('withConnection auto-releases', async () => {
    const result = await pool.withConnection(async (client) => {
      expect(client).toBeDefined();
      return 'done';
    });
    expect(result).toBe('done');
    const stats = pool.getStats();
    expect(stats.inUse).toBe(0);
  });

  it('reports pool stats', async () => {
    const stats = pool.getStats();
    expect(stats).toEqual({
      total: 0,
      inUse: 0,
      available: 0,
      waiting: 0,
    });
  });

  it('closes all connections on shutdown', async () => {
    const client = await pool.acquire();
    pool.release(client);
    await pool.shutdown();
    const stats = pool.getStats();
    expect(stats.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/connection/imap-pool.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement ImapPool**

```typescript
// src/connection/imap-pool.ts
import { ImapFlow } from 'imapflow';
import { ConnectionError } from '../errors.js';

export interface ImapPoolConfig {
  host: string;
  port: number;
  auth: { user: string; pass: string };
  poolSize: number;
  acquireTimeout: number;
  commandTimeout: number;
  idleTimeout: number;
}

interface PooledConnection {
  client: ImapFlow;
  lastUsed: number;
}

export class ImapPool {
  private available: PooledConnection[] = [];
  private inUse = new Set<ImapFlow>();
  private waiting: Array<{
    resolve: (client: ImapFlow) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private config: ImapPoolConfig;
  private closed = false;

  constructor(config: ImapPoolConfig) {
    this.config = config;
  }

  private async createConnection(): Promise<ImapFlow> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: false,
      tls: { rejectUnauthorized: false },
      auth: this.config.auth,
      logger: false,
    });

    client.on('error', () => {
      this.removeClient(client);
    });

    client.on('close', () => {
      this.removeClient(client);
    });

    try {
      await client.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConnectionError(message);
    }

    return client;
  }

  private removeClient(client: ImapFlow): void {
    this.inUse.delete(client);
    this.available = this.available.filter((c) => c.client !== client);
  }

  async acquire(): Promise<ImapFlow> {
    if (this.closed) throw new ConnectionError('Pool is shut down');

    // Try to reuse an available connection
    while (this.available.length > 0) {
      const pooled = this.available.pop()!;
      if (pooled.client.usable) {
        this.inUse.add(pooled.client);
        return pooled.client;
      }
      // Connection is stale, discard
      try { await pooled.client.logout(); } catch { /* ignore */ }
    }

    // Create new if under pool size
    const total = this.inUse.size + this.available.length;
    if (total < this.config.poolSize) {
      const client = await this.createConnection();
      this.inUse.add(client);
      return client;
    }

    // Wait for a connection to be released
    return new Promise<ImapFlow>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiting.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waiting.splice(idx, 1);
        reject(new ConnectionError(`Timed out waiting for IMAP connection (${this.config.acquireTimeout}ms)`));
      }, this.config.acquireTimeout);

      this.waiting.push({ resolve, reject, timer });
    });
  }

  release(client: ImapFlow): void {
    this.inUse.delete(client);

    // If someone is waiting, give them this connection
    if (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      clearTimeout(waiter.timer);
      this.inUse.add(client);
      waiter.resolve(client);
      return;
    }

    // Return to available pool
    if (client.usable) {
      this.available.push({ client, lastUsed: Date.now() });
    }
  }

  async withConnection<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = await this.acquire();
    try {
      return await fn(client);
    } finally {
      this.release(client);
    }
  }

  async withMailbox<T>(folder: string, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        return await fn(client);
      } finally {
        lock.release();
      }
    });
  }

  getStats() {
    return {
      total: this.inUse.size + this.available.length,
      inUse: this.inUse.size,
      available: this.available.length,
      waiting: this.waiting.length,
    };
  }

  isConnected(): boolean {
    return this.inUse.size + this.available.length > 0;
  }

  async shutdown(): Promise<void> {
    this.closed = true;

    for (const waiter of this.waiting) {
      clearTimeout(waiter.timer);
      waiter.reject(new ConnectionError('Pool is shutting down'));
    }
    this.waiting = [];

    const allClients = [
      ...Array.from(this.inUse),
      ...this.available.map((c) => c.client),
    ];

    for (const client of allClients) {
      try { await client.logout(); } catch { /* ignore */ }
    }

    this.inUse.clear();
    this.available = [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/connection/imap-pool.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/connection/imap-pool.ts tests/connection/imap-pool.test.ts
git commit -m "feat: add IMAP connection pool with acquire/release pattern"
```

---

### Task 6: MessageService

**Files:**
- Create: `src/services/message.service.ts`
- Create: `tests/services/message.test.ts`

- [ ] **Step 1: Write failing MessageService tests**

Test `listEmails`, `getUnreadCount`, `getEmailHeaders`, and `searchEmails`. Focus on the IMAP interaction patterns -- the service must correctly call ImapFlow methods and map results to our types.

```typescript
// tests/services/message.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MessageService } from '../../src/services/message.service.js';

function createMockPool() {
  return {
    withMailbox: vi.fn(),
    withConnection: vi.fn(),
  };
}

function createMockEnvelope() {
  return {
    subject: 'Test Subject',
    from: [{ name: 'Sender', address: 'sender@test.com' }],
    to: [{ name: 'Recipient', address: 'to@test.com' }],
    cc: [],
    date: new Date('2026-03-15T10:00:00Z'),
    messageId: '<msg1@test.com>',
    inReplyTo: undefined,
  };
}

describe('MessageService', () => {
  it('listEmails returns metadata for messages', async () => {
    const pool = createMockPool();
    const service = new MessageService(pool as any);

    pool.withMailbox.mockImplementation(async (_folder: string, fn: Function) => {
      const mockClient = {
        fetch: vi.fn().mockImplementation(async function* () {
          yield {
            uid: 1,
            envelope: createMockEnvelope(),
            flags: new Set(['\\Seen']),
            bodyStructure: { childNodes: [] },
          };
          yield {
            uid: 2,
            envelope: { ...createMockEnvelope(), subject: 'Second' },
            flags: new Set([]),
            bodyStructure: { childNodes: [{ disposition: 'attachment' }] },
          };
        }),
      };
      return fn(mockClient);
    });

    const result = await service.listEmails('INBOX', 20, 0);
    expect(result).toHaveLength(2);
    expect(result[0].uid).toBe(2); // newest first (reversed)
    expect(result[0].subject).toBe('Second');
    expect(result[0].hasAttachments).toBe(true);
    expect(result[1].uid).toBe(1);
    expect(result[1].hasAttachments).toBe(false);
  });

  it('getUnreadCount returns UNSEEN count', async () => {
    const pool = createMockPool();
    const service = new MessageService(pool as any);

    pool.withConnection.mockImplementation(async (fn: Function) => {
      const mockClient = {
        status: vi.fn().mockResolvedValue({ unseen: 5 }),
      };
      return fn(mockClient);
    });

    const count = await service.getUnreadCount('INBOX');
    expect(count).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/services/message.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement MessageService**

```typescript
// src/services/message.service.ts
import type { ImapPool } from '../connection/imap-pool.js';
import type { EmailMeta, Email, EmailHeaders, EmailAddress, AttachmentMeta, AttachmentContent, SearchCriteria } from '../types.js';
import PostalMime from 'postal-mime';

function toEmailAddress(addr: any): EmailAddress {
  return {
    name: addr?.name ?? '',
    address: addr?.address ?? '',
  };
}

function toEmailAddresses(addrs: any): EmailAddress[] {
  if (!addrs) return [];
  if (Array.isArray(addrs)) return addrs.map(toEmailAddress);
  return [toEmailAddress(addrs)];
}

function hasAttachmentParts(bodyStructure: any): boolean {
  if (!bodyStructure) return false;
  if (bodyStructure.disposition === 'attachment') return true;
  if (bodyStructure.childNodes) {
    return bodyStructure.childNodes.some((node: any) => hasAttachmentParts(node));
  }
  return false;
}

function buildSearchQuery(criteria: SearchCriteria): any {
  const query: any[] = [];

  if (criteria.from) query.push({ from: criteria.from });
  if (criteria.to) query.push({ to: criteria.to });
  if (criteria.subject) query.push({ subject: criteria.subject });
  if (criteria.body) query.push({ body: criteria.body });
  if (criteria.since) query.push({ since: criteria.since });
  if (criteria.before) query.push({ before: criteria.before });
  if (criteria.isUnread === true) query.push({ unseen: true });
  if (criteria.isUnread === false) query.push({ seen: true });

  if (query.length === 0) return { all: true };
  if (query.length === 1) return query[0];
  return { and: query };
}

export class MessageService {
  constructor(private pool: ImapPool) {}

  async listEmails(folder: string, limit: number, offset: number): Promise<EmailMeta[]> {
    return this.pool.withMailbox(folder, async (client) => {
      const allMessages: EmailMeta[] = [];

      for await (const msg of client.fetch('1:*', {
        envelope: true,
        flags: true,
        bodyStructure: true,
        uid: true,
      })) {
        const envelope = msg.envelope;
        allMessages.push({
          uid: msg.uid,
          subject: envelope.subject ?? '',
          from: toEmailAddresses(envelope.from),
          to: toEmailAddresses(envelope.to),
          cc: toEmailAddresses(envelope.cc),
          date: envelope.date ? new Date(envelope.date).toISOString() : '',
          flags: Array.from(msg.flags ?? []),
          hasAttachments: hasAttachmentParts(msg.bodyStructure),
          messageId: envelope.messageId,
        });
      }

      // Reverse for newest-first, then apply pagination
      allMessages.reverse();
      return allMessages.slice(offset, offset + limit);
    });
  }

  async getEmail(folder: string, uid: number, includeAttachments: boolean): Promise<Email> {
    return this.pool.withMailbox(folder, async (client) => {
      const msg = await client.fetchOne(String(uid), {
        source: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
        uid: true,
      });

      if (!msg) throw new Error(`Email with UID ${uid} not found in ${folder}`);

      const parser = new PostalMime();
      const parsed = await parser.parse(msg.source);

      const attachments = (parsed.attachments ?? []).map((att) => {
        const meta: AttachmentMeta = {
          filename: att.filename ?? 'unnamed',
          contentType: att.mimeType ?? 'application/octet-stream',
          size: att.content.byteLength,
          contentId: att.contentId,
        };
        if (includeAttachments) {
          return {
            ...meta,
            content: Buffer.from(att.content).toString('base64'),
          } as AttachmentContent;
        }
        return meta;
      });

      const envelope = msg.envelope;
      return {
        uid: msg.uid,
        subject: envelope.subject ?? '',
        from: toEmailAddresses(envelope.from),
        to: toEmailAddresses(envelope.to),
        cc: toEmailAddresses(envelope.cc),
        date: envelope.date ? new Date(envelope.date).toISOString() : '',
        flags: Array.from(msg.flags ?? []),
        hasAttachments: attachments.length > 0,
        messageId: envelope.messageId,
        textBody: parsed.text ?? '',
        htmlBody: parsed.html ?? '',
        headers: {
          subject: envelope.subject ?? '',
          from: toEmailAddresses(envelope.from),
          to: toEmailAddresses(envelope.to),
          cc: toEmailAddresses(envelope.cc),
          date: envelope.date ? new Date(envelope.date).toISOString() : '',
          messageId: envelope.messageId ?? '',
          inReplyTo: envelope.inReplyTo,
          references: parsed.headers?.references
            ? parsed.headers.references.split(/\s+/)
            : undefined,
        },
        attachments,
      };
    });
  }

  async getEmailHeaders(folder: string, uid: number): Promise<EmailHeaders> {
    return this.pool.withMailbox(folder, async (client) => {
      const msg = await client.fetchOne(String(uid), {
        envelope: true,
        headers: true,
        uid: true,
      });

      if (!msg) throw new Error(`Email with UID ${uid} not found in ${folder}`);

      const envelope = msg.envelope;
      let references: string[] | undefined;
      if (msg.headers) {
        const headersText = msg.headers.toString();
        const refMatch = headersText.match(/^References:\s*(.+?)(?:\r?\n(?!\s)|$)/ms);
        if (refMatch) {
          references = refMatch[1].trim().split(/\s+/);
        }
      }

      return {
        subject: envelope.subject ?? '',
        from: toEmailAddresses(envelope.from),
        to: toEmailAddresses(envelope.to),
        cc: toEmailAddresses(envelope.cc),
        date: envelope.date ? new Date(envelope.date).toISOString() : '',
        messageId: envelope.messageId ?? '',
        inReplyTo: envelope.inReplyTo,
        references,
      };
    });
  }

  async searchEmails(
    folder: string,
    criteria: SearchCriteria,
    limit: number,
    offset: number,
  ): Promise<EmailMeta[]> {
    return this.pool.withMailbox(folder, async (client) => {
      const query = buildSearchQuery(criteria);
      const uids = await client.search(query, { uid: true });

      if (uids.length === 0) return [];

      const uidList = uids.reverse(); // newest first
      const paginatedUids = uidList.slice(offset, offset + limit);

      const results: EmailMeta[] = [];
      for await (const msg of client.fetch(
        paginatedUids.map(String).join(','),
        { envelope: true, flags: true, bodyStructure: true, uid: true },
      )) {
        const envelope = msg.envelope;
        const meta: EmailMeta = {
          uid: msg.uid,
          subject: envelope.subject ?? '',
          from: toEmailAddresses(envelope.from),
          to: toEmailAddresses(envelope.to),
          cc: toEmailAddresses(envelope.cc),
          date: envelope.date ? new Date(envelope.date).toISOString() : '',
          flags: Array.from(msg.flags ?? []),
          hasAttachments: hasAttachmentParts(msg.bodyStructure),
          messageId: envelope.messageId,
        };

        if (criteria.hasAttachment !== undefined) {
          if (criteria.hasAttachment !== meta.hasAttachments) continue;
        }

        results.push(meta);
      }

      return results;
    });
  }

  async getUnreadCount(folder: string): Promise<number> {
    return this.pool.withConnection(async (client) => {
      const status = await client.status(folder, { unseen: true });
      return status.unseen ?? 0;
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/services/message.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/message.service.ts tests/services/message.test.ts
git commit -m "feat: add MessageService for listing, fetching, and searching emails"
```

---

### Task 7: MailboxService

**Files:**
- Create: `src/services/mailbox.service.ts`
- Create: `tests/services/mailbox.test.ts`

- [ ] **Step 1: Write failing MailboxService tests**

```typescript
// tests/services/mailbox.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MailboxService } from '../../src/services/mailbox.service.js';

function createMockPool() {
  return { withConnection: vi.fn() };
}

describe('MailboxService', () => {
  it('listFolders classifies system, folder, and label types', async () => {
    const pool = createMockPool();
    const service = new MailboxService(pool as any);

    pool.withConnection.mockImplementation(async (fn: Function) => {
      const mockClient = {
        list: vi.fn().mockResolvedValue([
          { path: 'INBOX', name: 'INBOX', delimiter: '/', specialUse: '\\Inbox', flags: new Set() },
          { path: 'Folders/Work', name: 'Work', delimiter: '/', flags: new Set() },
          { path: 'Labels/Important', name: 'Important', delimiter: '/', flags: new Set() },
        ]),
      };
      return fn(mockClient);
    });

    const folders = await service.listFolders();
    expect(folders).toHaveLength(3);
    expect(folders[0].type).toBe('system');
    expect(folders[1].type).toBe('folder');
    expect(folders[2].type).toBe('label');
  });

  it('listLabels returns only labels', async () => {
    const pool = createMockPool();
    const service = new MailboxService(pool as any);

    pool.withConnection.mockImplementation(async (fn: Function) => {
      const mockClient = {
        list: vi.fn().mockResolvedValue([
          { path: 'INBOX', name: 'INBOX', delimiter: '/', specialUse: '\\Inbox', flags: new Set() },
          { path: 'Labels/Urgent', name: 'Urgent', delimiter: '/', flags: new Set() },
        ]),
      };
      return fn(mockClient);
    });

    const labels = await service.listLabels();
    expect(labels).toHaveLength(1);
    expect(labels[0].name).toBe('Urgent');
  });

  it('createFolder prepends Folders/ prefix', async () => {
    const pool = createMockPool();
    const service = new MailboxService(pool as any);
    let createdPath = '';

    pool.withConnection.mockImplementation(async (fn: Function) => {
      const mockClient = {
        mailboxCreate: vi.fn().mockImplementation((path: string) => {
          createdPath = path;
          return Promise.resolve({ path });
        }),
      };
      return fn(mockClient);
    });

    await service.createFolder('Work');
    expect(createdPath).toBe('Folders/Work');
  });

  it('createLabel prepends Labels/ prefix', async () => {
    const pool = createMockPool();
    const service = new MailboxService(pool as any);
    let createdPath = '';

    pool.withConnection.mockImplementation(async (fn: Function) => {
      const mockClient = {
        mailboxCreate: vi.fn().mockImplementation((path: string) => {
          createdPath = path;
          return Promise.resolve({ path });
        }),
      };
      return fn(mockClient);
    });

    await service.createLabel('Priority');
    expect(createdPath).toBe('Labels/Priority');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/services/mailbox.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement MailboxService**

```typescript
// src/services/mailbox.service.ts
import type { ImapPool } from '../connection/imap-pool.js';
import type { Folder } from '../types.js';
import { MailboxError } from '../errors.js';

const SYSTEM_FOLDERS = new Set([
  'INBOX', 'Drafts', 'Sent', 'Archive', 'Spam', 'Trash', 'Starred', 'All Mail',
]);

function classifyFolder(path: string, specialUse?: string): 'system' | 'folder' | 'label' {
  if (specialUse || SYSTEM_FOLDERS.has(path)) return 'system';
  if (path.startsWith('Labels/')) return 'label';
  return 'folder';
}

export class MailboxService {
  constructor(private pool: ImapPool) {}

  async listFolders(): Promise<Folder[]> {
    return this.pool.withConnection(async (client) => {
      const mailboxes = await client.list();
      return mailboxes.map((mb: any) => ({
        path: mb.path,
        name: mb.name,
        delimiter: mb.delimiter ?? '/',
        specialUse: mb.specialUse,
        type: classifyFolder(mb.path, mb.specialUse),
        flags: Array.from(mb.flags ?? []),
      }));
    });
  }

  async listLabels(): Promise<Folder[]> {
    const all = await this.listFolders();
    return all.filter((f) => f.type === 'label');
  }

  async createFolder(name: string, parent?: string): Promise<string> {
    const path = parent ? `Folders/${parent}/${name}` : `Folders/${name}`;
    return this.pool.withConnection(async (client) => {
      const result = await client.mailboxCreate(path);
      return result.path;
    });
  }

  async renameFolder(oldName: string, newName: string): Promise<void> {
    if (SYSTEM_FOLDERS.has(oldName)) {
      throw new MailboxError(`Cannot rename system folder: ${oldName}`);
    }
    return this.pool.withConnection(async (client) => {
      await client.mailboxRename(oldName, newName);
    });
  }

  async createLabel(name: string): Promise<string> {
    const path = `Labels/${name}`;
    return this.pool.withConnection(async (client) => {
      const result = await client.mailboxCreate(path);
      return result.path;
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/services/mailbox.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/mailbox.service.ts tests/services/mailbox.test.ts
git commit -m "feat: add MailboxService for folder and label management"
```

---

### Task 8: OrganizeService

**Files:**
- Create: `src/services/organize.service.ts`
- Create: `tests/services/organize.test.ts`

- [ ] **Step 1: Write failing OrganizeService tests**

```typescript
// tests/services/organize.test.ts
import { describe, it, expect, vi } from 'vitest';
import { OrganizeService } from '../../src/services/organize.service.js';

function createMockPool() {
  return { withMailbox: vi.fn() };
}

describe('OrganizeService', () => {
  it('moveEmails calls IMAP messageMove', async () => {
    const pool = createMockPool();
    const service = new OrganizeService(pool as any);
    const moveFn = vi.fn();

    pool.withMailbox.mockImplementation(async (_f: string, fn: Function) => {
      return fn({ messageMove: moveFn });
    });

    await service.moveEmails('INBOX', [1, 2], 'Archive');
    expect(moveFn).toHaveBeenCalledWith('1,2', 'Archive', { uid: true });
  });

  it('markAsRead adds \\Seen flag', async () => {
    const pool = createMockPool();
    const service = new OrganizeService(pool as any);
    const flagsAddFn = vi.fn();

    pool.withMailbox.mockImplementation(async (_f: string, fn: Function) => {
      return fn({ messageFlagsAdd: flagsAddFn });
    });

    await service.markAsRead('INBOX', [1]);
    expect(flagsAddFn).toHaveBeenCalledWith('1', ['\\Seen'], { uid: true });
  });

  it('applyLabels uses messageCopy (not move)', async () => {
    const pool = createMockPool();
    const service = new OrganizeService(pool as any);
    const copyFn = vi.fn();

    pool.withMailbox.mockImplementation(async (_f: string, fn: Function) => {
      return fn({ messageCopy: copyFn });
    });

    await service.applyLabels('INBOX', [1], ['Important', 'Work']);
    expect(copyFn).toHaveBeenCalledTimes(2);
    expect(copyFn).toHaveBeenCalledWith('1', 'Labels/Important', { uid: true });
    expect(copyFn).toHaveBeenCalledWith('1', 'Labels/Work', { uid: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/services/organize.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement OrganizeService**

```typescript
// src/services/organize.service.ts
import type { ImapPool } from '../connection/imap-pool.js';

export class OrganizeService {
  constructor(private pool: ImapPool) {}

  async moveEmails(folder: string, uids: number[], destination: string): Promise<void> {
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageMove(uids.join(','), destination, { uid: true });
    });
  }

  async markAsRead(folder: string, uids: number[]): Promise<void> {
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true });
    });
  }

  async markAsUnread(folder: string, uids: number[]): Promise<void> {
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageFlagsRemove(uids.join(','), ['\\Seen'], { uid: true });
    });
  }

  async starEmail(folder: string, uids: number[]): Promise<void> {
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageFlagsAdd(uids.join(','), ['\\Flagged'], { uid: true });
    });
  }

  async unstarEmail(folder: string, uids: number[]): Promise<void> {
    await this.pool.withMailbox(folder, async (client) => {
      await client.messageFlagsRemove(uids.join(','), ['\\Flagged'], { uid: true });
    });
  }

  async applyLabels(folder: string, uids: number[], labels: string[]): Promise<void> {
    await this.pool.withMailbox(folder, async (client) => {
      const uidStr = uids.join(',');
      for (const label of labels) {
        const labelPath = label.startsWith('Labels/') ? label : `Labels/${label}`;
        await client.messageCopy(uidStr, labelPath, { uid: true });
      }
    });
  }

  async removeLabels(folder: string, uids: number[], labels: string[]): Promise<void> {
    const messageIds: string[] = [];
    await this.pool.withMailbox(folder, async (client) => {
      for await (const msg of client.fetch(uids.join(','), { envelope: true, uid: true })) {
        if (msg.envelope.messageId) {
          messageIds.push(msg.envelope.messageId);
        }
      }
    });

    for (const label of labels) {
      const labelPath = label.startsWith('Labels/') ? label : `Labels/${label}`;
      await this.pool.withMailbox(labelPath, async (client) => {
        for (const msgId of messageIds) {
          const found = await client.search({ header: { 'message-id': msgId } }, { uid: true });
          if (found.length > 0) {
            await client.messageFlagsAdd(found.join(','), ['\\Deleted'], { uid: true });
            await client.messageDelete(found.join(','), { uid: true });
          }
        }
      });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/services/organize.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/organize.service.ts tests/services/organize.test.ts
git commit -m "feat: add OrganizeService for move, flags, and labels"
```

---

### Task 9: DraftService

**Files:**
- Create: `src/services/draft.service.ts`
- Create: `tests/services/draft.test.ts`

- [ ] **Step 1: Write failing DraftService tests**

```typescript
// tests/services/draft.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DraftService } from '../../src/services/draft.service.js';

function createMockPool() {
  return {
    withMailbox: vi.fn(),
    withConnection: vi.fn(),
  };
}

function createMockMessageService() {
  return {
    listEmails: vi.fn().mockResolvedValue([]),
    getEmail: vi.fn(),
  };
}

describe('DraftService', () => {
  it('saveDraft appends to Drafts folder with \\Draft flag', async () => {
    const pool = createMockPool();
    const msgService = createMockMessageService();
    const service = new DraftService(pool as any, msgService as any);
    let appendedFolder = '';
    let appendedFlags: string[] = [];

    pool.withConnection.mockImplementation(async (fn: Function) => {
      return fn({
        append: vi.fn().mockImplementation((folder: string, content: any, flags: string[]) => {
          appendedFolder = folder;
          appendedFlags = flags;
          return Promise.resolve({ uid: 99 });
        }),
      });
    });

    const uid = await service.saveDraft({
      to: ['test@example.com'],
      subject: 'Test Draft',
      body: 'Hello',
    });

    expect(appendedFolder).toBe('Drafts');
    expect(appendedFlags).toContain('\\Draft');
  });

  it('listDrafts delegates to MessageService', async () => {
    const pool = createMockPool();
    const msgService = createMockMessageService();
    const service = new DraftService(pool as any, msgService as any);

    await service.listDrafts(20, 0);
    expect(msgService.listEmails).toHaveBeenCalledWith('Drafts', 20, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/services/draft.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement DraftService**

```typescript
// src/services/draft.service.ts
import { createTransport } from 'nodemailer';
import type { ImapPool } from '../connection/imap-pool.js';
import type { MessageService } from './message.service.js';
import type { DraftInput, EmailMeta } from '../types.js';

function buildRfc822(input: DraftInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const transport = createTransport({ streamTransport: true });
    const mailOptions: any = {
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.body,
    };

    if (input.html) mailOptions.html = input.html;
    if (input.cc) mailOptions.cc = input.cc;
    if (input.bcc) mailOptions.bcc = input.bcc;
    if (input.inReplyTo) mailOptions.inReplyTo = input.inReplyTo;
    if (input.references) mailOptions.references = input.references.join(' ');

    if (input.attachments) {
      mailOptions.attachments = input.attachments.map((att) => ({
        filename: att.filename,
        content: Buffer.from(att.content_base64, 'base64'),
        contentType: att.content_type,
      }));
    }

    transport.sendMail(mailOptions, (err, info) => {
      if (err) return reject(err);
      const chunks: Buffer[] = [];
      info.message.on('data', (chunk: Buffer) => chunks.push(chunk));
      info.message.on('end', () => resolve(Buffer.concat(chunks)));
      info.message.on('error', reject);
    });
  });
}

export class DraftService {
  constructor(
    private pool: ImapPool,
    private messageService: MessageService,
  ) {}

  async saveDraft(input: DraftInput): Promise<number> {
    const raw = await buildRfc822(input);

    return this.pool.withConnection(async (client) => {
      const result = await client.append('Drafts', raw, ['\\Draft', '\\Seen']);
      return result.uid ?? 0;
    });
  }

  async listDrafts(limit: number, offset: number): Promise<EmailMeta[]> {
    return this.messageService.listEmails('Drafts', limit, offset);
  }

  async updateDraft(uid: number, input: DraftInput): Promise<number> {
    // Fetch existing draft to merge fields
    const existing = await this.messageService.getEmail('Drafts', uid, false);

    const merged: DraftInput = {
      to: input.to.length > 0 ? input.to : existing.to.map((a) => a.address),
      subject: input.subject || existing.subject,
      body: input.body || existing.textBody,
      html: input.html ?? existing.htmlBody || undefined,
      from: input.from,
      cc: input.cc ?? existing.cc.map((a) => a.address),
      inReplyTo: input.inReplyTo ?? existing.headers.inReplyTo,
      references: input.references ?? existing.headers.references,
      attachments: input.attachments,
    };

    // Delete old draft (exception to no-delete policy: standard IMAP draft workflow)
    await this.pool.withMailbox('Drafts', async (client) => {
      await client.messageFlagsAdd(String(uid), ['\\Deleted'], { uid: true });
      await client.messageDelete(String(uid), { uid: true });
    });

    return this.saveDraft(merged);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/services/draft.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/draft.service.ts tests/services/draft.test.ts
git commit -m "feat: add DraftService for creating and managing drafts"
```

---

## Chunk 3: MCP Integration

### Task 10: MCP Tool Definitions - Reading

**Files:**
- Create: `src/tools/reading.ts`

- [ ] **Step 1: Implement reading tools**

Each tool is a function that registers itself on the MCP server using `server.tool()` with Zod schemas.

```typescript
// src/tools/reading.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MessageService } from '../services/message.service.js';
import { errorToToolResponse } from '../errors.js';

export function registerReadingTools(server: McpServer, messageService: MessageService): void {
  server.tool(
    'list_emails',
    'List emails from a folder with pagination. Returns metadata only (subject, sender, date, flags).',
    {
      folder: z.string().default('INBOX').describe('Folder to list emails from'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max emails to return'),
      offset: z.number().int().min(0).default(0).describe('Number of emails to skip'),
    },
    async ({ folder, limit, offset }) => {
      try {
        const emails = await messageService.listEmails(folder, limit, offset);
        return { content: [{ type: 'text', text: JSON.stringify(emails) }] };
      } catch (err) {
        return errorToToolResponse(err, 'list_emails');
      }
    },
  );

  server.tool(
    'get_email',
    'Get a full email by UID including body content.',
    {
      folder: z.string().describe('Folder containing the email'),
      uid: z.number().int().describe('Email UID'),
      include_attachments: z.boolean().default(false).describe('Include attachment content (base64)'),
    },
    async ({ folder, uid, include_attachments }) => {
      try {
        const email = await messageService.getEmail(folder, uid, include_attachments);
        return { content: [{ type: 'text', text: JSON.stringify(email) }] };
      } catch (err) {
        return errorToToolResponse(err, 'get_email');
      }
    },
  );

  server.tool(
    'get_email_headers',
    'Get email headers only. Lightweight alternative to get_email.',
    {
      folder: z.string().describe('Folder containing the email'),
      uid: z.number().int().describe('Email UID'),
    },
    async ({ folder, uid }) => {
      try {
        const headers = await messageService.getEmailHeaders(folder, uid);
        return { content: [{ type: 'text', text: JSON.stringify(headers) }] };
      } catch (err) {
        return errorToToolResponse(err, 'get_email_headers');
      }
    },
  );

  server.tool(
    'search_emails',
    'Search emails with criteria. Returns metadata for matching emails.',
    {
      folder: z.string().default('INBOX').describe('Folder to search'),
      from: z.string().optional().describe('Sender email or name'),
      to: z.string().optional().describe('Recipient email or name'),
      subject: z.string().optional().describe('Subject contains'),
      body: z.string().optional().describe('Body contains'),
      since: z.string().optional().describe('Emails after this date (ISO 8601)'),
      before: z.string().optional().describe('Emails before this date (ISO 8601)'),
      has_attachment: z.boolean().optional().describe('Filter by attachment presence'),
      is_unread: z.boolean().optional().describe('Filter by read/unread status'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
      offset: z.number().int().min(0).default(0).describe('Number of results to skip'),
    },
    async (params) => {
      try {
        const { folder, limit, offset, ...criteria } = params;
        const emails = await messageService.searchEmails(folder, {
          from: criteria.from,
          to: criteria.to,
          subject: criteria.subject,
          body: criteria.body,
          since: criteria.since,
          before: criteria.before,
          hasAttachment: criteria.has_attachment,
          isUnread: criteria.is_unread,
        }, limit, offset);
        return { content: [{ type: 'text', text: JSON.stringify(emails) }] };
      } catch (err) {
        return errorToToolResponse(err, 'search_emails');
      }
    },
  );

  server.tool(
    'get_unread_count',
    'Get unread email count for a folder.',
    {
      folder: z.string().default('INBOX').describe('Folder to check'),
    },
    async ({ folder }) => {
      try {
        const count = await messageService.getUnreadCount(folder);
        return { content: [{ type: 'text', text: JSON.stringify({ folder, unread: count }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'get_unread_count');
      }
    },
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/reading.ts
git commit -m "feat: add MCP reading tools (list, get, search, headers, unread)"
```

---

### Task 11: MCP Tool Definitions - Composing, Organizing, Mailbox, Connection

**Files:**
- Create: `src/tools/composing.ts`
- Create: `src/tools/organizing.ts`
- Create: `src/tools/mailbox.ts`
- Create: `src/tools/connection.ts`

- [ ] **Step 1: Implement composing tools**

```typescript
// src/tools/composing.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DraftService } from '../services/draft.service.js';
import { errorToToolResponse } from '../errors.js';

const AttachmentSchema = z.object({
  filename: z.string(),
  content_base64: z.string(),
  content_type: z.string(),
});

export function registerComposingTools(server: McpServer, draftService: DraftService): void {
  server.tool(
    'save_draft',
    'Save an email as a draft. Does not send.',
    {
      to: z.array(z.string()).describe('Recipient email addresses'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Plain text body'),
      html: z.string().optional().describe('HTML body'),
      from: z.string().optional().describe('Sender address (for aliases)'),
      cc: z.array(z.string()).optional().describe('CC addresses'),
      bcc: z.array(z.string()).optional().describe('BCC addresses'),
      in_reply_to: z.string().optional().describe('Message-ID for threading'),
      references: z.array(z.string()).optional().describe('Message-ID chain for threading'),
      attachments: z.array(AttachmentSchema).optional().describe('File attachments'),
    },
    async (params) => {
      try {
        const uid = await draftService.saveDraft({
          to: params.to,
          subject: params.subject,
          body: params.body,
          html: params.html,
          from: params.from,
          cc: params.cc,
          bcc: params.bcc,
          inReplyTo: params.in_reply_to,
          references: params.references,
          attachments: params.attachments,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ uid, saved: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'save_draft');
      }
    },
  );

  server.tool(
    'list_drafts',
    'List all drafts.',
    {
      limit: z.number().int().min(1).max(100).default(20).describe('Max drafts to return'),
      offset: z.number().int().min(0).default(0).describe('Number of drafts to skip'),
    },
    async ({ limit, offset }) => {
      try {
        const drafts = await draftService.listDrafts(limit, offset);
        return { content: [{ type: 'text', text: JSON.stringify(drafts) }] };
      } catch (err) {
        return errorToToolResponse(err, 'list_drafts');
      }
    },
  );

  server.tool(
    'update_draft',
    'Update an existing draft. Replaces the draft with updated content.',
    {
      uid: z.number().int().describe('Draft UID to update'),
      to: z.array(z.string()).optional().describe('Updated recipients'),
      subject: z.string().optional().describe('Updated subject'),
      body: z.string().optional().describe('Updated plain text body'),
      html: z.string().optional().describe('Updated HTML body'),
      cc: z.array(z.string()).optional().describe('Updated CC'),
      bcc: z.array(z.string()).optional().describe('Updated BCC'),
      attachments: z.array(AttachmentSchema).optional().describe('Updated attachments'),
    },
    async (params) => {
      try {
        const newUid = await draftService.updateDraft(params.uid, {
          to: params.to ?? [],
          subject: params.subject ?? '',
          body: params.body ?? '',
          html: params.html,
          cc: params.cc,
          attachments: params.attachments,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ uid: newUid, updated: true }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'update_draft');
      }
    },
  );
}
```

- [ ] **Step 2: Implement organizing tools**

```typescript
// src/tools/organizing.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OrganizeService } from '../services/organize.service.js';
import { errorToToolResponse } from '../errors.js';

export function registerOrganizingTools(server: McpServer, organizeService: OrganizeService): void {
  server.tool(
    'move_emails',
    'Move emails to a different folder.',
    {
      folder: z.string().describe('Source folder'),
      uids: z.array(z.number().int()).describe('Email UIDs to move'),
      destination: z.string().describe('Destination folder'),
    },
    async ({ folder, uids, destination }) => {
      try {
        await organizeService.moveEmails(folder, uids, destination);
        return { content: [{ type: 'text', text: JSON.stringify({ moved: uids.length, destination }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'move_emails');
      }
    },
  );

  server.tool(
    'mark_as_read',
    'Mark emails as read.',
    {
      folder: z.string().describe('Folder containing the emails'),
      uids: z.array(z.number().int()).describe('Email UIDs'),
    },
    async ({ folder, uids }) => {
      try {
        await organizeService.markAsRead(folder, uids);
        return { content: [{ type: 'text', text: JSON.stringify({ marked: uids.length }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'mark_as_read');
      }
    },
  );

  server.tool(
    'mark_as_unread',
    'Mark emails as unread.',
    {
      folder: z.string().describe('Folder containing the emails'),
      uids: z.array(z.number().int()).describe('Email UIDs'),
    },
    async ({ folder, uids }) => {
      try {
        await organizeService.markAsUnread(folder, uids);
        return { content: [{ type: 'text', text: JSON.stringify({ marked: uids.length }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'mark_as_unread');
      }
    },
  );

  server.tool(
    'star_email',
    'Star/flag emails.',
    {
      folder: z.string().describe('Folder containing the emails'),
      uids: z.array(z.number().int()).describe('Email UIDs'),
    },
    async ({ folder, uids }) => {
      try {
        await organizeService.starEmail(folder, uids);
        return { content: [{ type: 'text', text: JSON.stringify({ starred: uids.length }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'star_email');
      }
    },
  );

  server.tool(
    'unstar_email',
    'Remove star/flag from emails.',
    {
      folder: z.string().describe('Folder containing the emails'),
      uids: z.array(z.number().int()).describe('Email UIDs'),
    },
    async ({ folder, uids }) => {
      try {
        await organizeService.unstarEmail(folder, uids);
        return { content: [{ type: 'text', text: JSON.stringify({ unstarred: uids.length }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'unstar_email');
      }
    },
  );

  server.tool(
    'apply_labels',
    'Apply labels to emails. Preserves original folder location.',
    {
      folder: z.string().describe('Folder containing the emails'),
      uids: z.array(z.number().int()).describe('Email UIDs'),
      labels: z.array(z.string()).describe('Label names to apply'),
    },
    async ({ folder, uids, labels }) => {
      try {
        await organizeService.applyLabels(folder, uids, labels);
        return { content: [{ type: 'text', text: JSON.stringify({ applied: labels, count: uids.length }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'apply_labels');
      }
    },
  );

  server.tool(
    'remove_labels',
    'Remove labels from emails. Only removes the label association; the original email remains in its folder.',
    {
      folder: z.string().describe('Source folder where UIDs are valid'),
      uids: z.array(z.number().int()).describe('Email UIDs'),
      labels: z.array(z.string()).describe('Label names to remove'),
    },
    async ({ folder, uids, labels }) => {
      try {
        await organizeService.removeLabels(folder, uids, labels);
        return { content: [{ type: 'text', text: JSON.stringify({ removed: labels, count: uids.length }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'remove_labels');
      }
    },
  );
}
```

- [ ] **Step 3: Implement mailbox tools**

```typescript
// src/tools/mailbox.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MailboxService } from '../services/mailbox.service.js';
import { errorToToolResponse } from '../errors.js';

export function registerMailboxTools(server: McpServer, mailboxService: MailboxService): void {
  server.tool(
    'list_folders',
    'List all folders and their properties.',
    {},
    async () => {
      try {
        const folders = await mailboxService.listFolders();
        return { content: [{ type: 'text', text: JSON.stringify(folders) }] };
      } catch (err) {
        return errorToToolResponse(err, 'list_folders');
      }
    },
  );

  server.tool(
    'create_folder',
    'Create a new folder.',
    {
      name: z.string().describe('Folder name'),
      parent: z.string().optional().describe('Parent folder path'),
    },
    async ({ name, parent }) => {
      try {
        const path = await mailboxService.createFolder(name, parent);
        return { content: [{ type: 'text', text: JSON.stringify({ created: path }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'create_folder');
      }
    },
  );

  server.tool(
    'rename_folder',
    'Rename an existing folder. Cannot rename system folders.',
    {
      old_name: z.string().describe('Current folder path'),
      new_name: z.string().describe('New folder path'),
    },
    async ({ old_name, new_name }) => {
      try {
        await mailboxService.renameFolder(old_name, new_name);
        return { content: [{ type: 'text', text: JSON.stringify({ renamed: { from: old_name, to: new_name } }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'rename_folder');
      }
    },
  );

  server.tool(
    'list_labels',
    'List all labels.',
    {},
    async () => {
      try {
        const labels = await mailboxService.listLabels();
        return { content: [{ type: 'text', text: JSON.stringify(labels) }] };
      } catch (err) {
        return errorToToolResponse(err, 'list_labels');
      }
    },
  );

  server.tool(
    'create_label',
    'Create a new label.',
    {
      name: z.string().describe('Label name'),
    },
    async ({ name }) => {
      try {
        const path = await mailboxService.createLabel(name);
        return { content: [{ type: 'text', text: JSON.stringify({ created: path }) }] };
      } catch (err) {
        return errorToToolResponse(err, 'create_label');
      }
    },
  );
}
```

- [ ] **Step 4: Implement connection tool**

```typescript
// src/tools/connection.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapPool } from '../connection/imap-pool.js';
import { errorToToolResponse } from '../errors.js';

export function registerConnectionTools(server: McpServer, pool: ImapPool): void {
  server.tool(
    'get_connection_status',
    'Check IMAP connection health and pool statistics.',
    {},
    async () => {
      try {
        const stats = pool.getStats();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              imap: {
                connected: pool.isConnected(),
                pool: stats,
              },
            }),
          }],
        };
      } catch (err) {
        return errorToToolResponse(err, 'get_connection_status');
      }
    },
  );
}
```

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tools/
git commit -m "feat: add all MCP tool definitions (reading, composing, organizing, mailbox, connection)"
```

---

### Task 12: Server Entry Point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Implement server bootstrap**

```typescript
// src/index.ts
#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createCredentialProvider } from './credentials/provider.js';
import { ImapPool } from './connection/imap-pool.js';
import { MessageService } from './services/message.service.js';
import { MailboxService } from './services/mailbox.service.js';
import { OrganizeService } from './services/organize.service.js';
import { DraftService } from './services/draft.service.js';
import { registerReadingTools } from './tools/reading.js';
import { registerComposingTools } from './tools/composing.js';
import { registerOrganizingTools } from './tools/organizing.js';
import { registerMailboxTools } from './tools/mailbox.js';
import { registerConnectionTools } from './tools/connection.js';

async function main() {
  const config = loadConfig();

  const credentialProvider = createCredentialProvider(config);
  const credentials = await credentialProvider.getCredentials();

  const pool = new ImapPool({
    host: config.imap.host,
    port: config.imap.port,
    auth: { user: credentials.username, pass: credentials.password },
    poolSize: config.imap.poolSize,
    acquireTimeout: config.imap.acquireTimeout,
    commandTimeout: config.imap.commandTimeout,
    idleTimeout: config.imap.idleTimeout,
  });

  const messageService = new MessageService(pool);
  const mailboxService = new MailboxService(pool);
  const organizeService = new OrganizeService(pool);
  const draftService = new DraftService(pool, messageService);

  const server = new McpServer({
    name: 'proton-bridge-mcp',
    version: '0.1.0',
  });

  registerReadingTools(server, messageService);
  registerComposingTools(server, draftService);
  registerOrganizingTools(server, organizeService);
  registerMailboxTools(server, mailboxService);
  registerConnectionTools(server, pool);

  const shutdown = async () => {
    await pool.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start proton-bridge-mcp:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Build the project**

```bash
npx tsc
```

Expected: compiles to `dist/` with no errors.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add server entry point wiring all layers together"
```

---

### Task 13: Final Verification

**Files:**
- Verify: all files

- [ ] **Step 1: Full clean build**

```bash
rm -rf dist && npx tsc
```

Expected: clean build, no errors.

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Verify the binary starts**

```bash
echo '{}' | PROTON_BRIDGE_USERNAME=test PROTON_BRIDGE_PASSWORD=test timeout 2 node dist/index.js || true
```

Expected: starts without crash, then times out (no MCP client connected).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final build verification"
```
