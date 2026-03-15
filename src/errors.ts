// Error hierarchy for the Proton Bridge MCP server

export enum ErrorType {
  CONNECTION = 'CONNECTION',
  AUTH = 'AUTH',
  MAILBOX = 'MAILBOX',
  CREDENTIAL = 'CREDENTIAL',
  VALIDATION = 'VALIDATION',
}

export class ProtonBridgeError extends Error {
  public readonly type: ErrorType;
  public readonly suggestions: string[];

  constructor(message: string, type: ErrorType, suggestions: string[] = []) {
    super(message);
    this.name = 'ProtonBridgeError';
    this.type = type;
    this.suggestions = suggestions;
    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConnectionError extends ProtonBridgeError {
  constructor(message: string, suggestions?: string[]) {
    super(message, ErrorType.CONNECTION, suggestions ?? [
      'Ensure Proton Bridge is running and connected to your Proton account.',
      'Check that the Bridge IMAP port (default 1143) is accessible.',
      'Verify no firewall or VPN is blocking the local Bridge connection.',
    ]);
    this.name = 'ConnectionError';
  }
}

export class AuthError extends ProtonBridgeError {
  constructor(message: string, suggestions?: string[]) {
    super(message, ErrorType.AUTH, suggestions ?? [
      'Use the Bridge-specific password shown in the Proton Bridge app, not your Proton account password.',
      'Open the Proton Bridge app and copy the bridge password from the account settings.',
      'If the password was recently regenerated in Bridge, update your credential store.',
    ]);
    this.name = 'AuthError';
  }
}

export class MailboxError extends ProtonBridgeError {
  constructor(message: string, suggestions?: string[]) {
    super(message, ErrorType.MAILBOX, suggestions ?? [
      'Run the list_folders tool to see available folders and their exact paths.',
      'Folder paths in Proton Bridge use IMAP naming conventions (e.g. "Folders/MyFolder").',
    ]);
    this.name = 'MailboxError';
  }
}

export class CredentialError extends ProtonBridgeError {
  constructor(message: string, suggestions?: string[]) {
    super(message, ErrorType.CREDENTIAL, suggestions ?? [
      '1Password: store credentials in a vault item and reference via OP_ITEM env var.',
      'Proton Pass: export the Bridge credentials and reference via PROTON_PASS_ITEM env var.',
      'Environment variables: set BRIDGE_USERNAME and BRIDGE_PASSWORD in your shell or .env file.',
      'Ensure your credential provider CLI (op, pass, etc.) is authenticated before starting the server.',
    ]);
    this.name = 'CredentialError';
  }
}

export class ValidationError extends ProtonBridgeError {
  constructor(message: string, suggestions?: string[]) {
    super(message, ErrorType.VALIDATION, suggestions ?? [
      'Check the tool input against the schema documented in the tool description.',
    ]);
    this.name = 'ValidationError';
  }
}

/**
 * Map a raw error from an IMAP library or network layer to a typed ProtonBridgeError.
 */
export function classifyError(err: unknown): ProtonBridgeError {
  if (err instanceof ProtonBridgeError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const code = (err as NodeJS.ErrnoException).code;

  // Network-level connection refused
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
    return new ConnectionError(
      `Connection failed (${code}): ${message}`,
    );
  }

  // Timeout
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(message)) {
    return new ConnectionError(`Connection timed out: ${message}`);
  }

  // Authentication failure signals from IMAP servers
  if (
    /auth|login|credential|password|username|invalid.*user|user.*invalid/i.test(message)
  ) {
    return new AuthError(`Authentication failed: ${message}`);
  }

  // Mailbox / folder not found
  if (/no such mailbox|mailbox.*not.*exist|folder.*not.*found|NONEXISTENT/i.test(message)) {
    return new MailboxError(`Mailbox not found: ${message}`);
  }

  // Generic connection error fallback
  if (/connect|socket|network/i.test(message) || code !== undefined) {
    return new ConnectionError(`Unexpected connection error: ${message}`);
  }

  // Fallback - wrap in base class
  return new ProtonBridgeError(message, ErrorType.CONNECTION);
}

interface McpToolResponseContent {
  type: 'text';
  text: string;
}

interface McpToolResponse {
  content: McpToolResponseContent[];
  isError: true;
}

/**
 * Format an error as an MCP tool response with isError: true.
 */
export function errorToToolResponse(err: unknown, tool?: string): McpToolResponse {
  const typed = classifyError(err);

  const lines: string[] = [];

  if (tool) {
    lines.push(`Error in ${tool}: ${typed.message}`);
  } else {
    lines.push(`Error: ${typed.message}`);
  }

  lines.push(`Type: ${typed.type}`);

  if (typed.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const suggestion of typed.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n'),
      },
    ],
    isError: true,
  };
}
