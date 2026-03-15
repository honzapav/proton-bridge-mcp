# Proton Bridge MCP Server - Design Spec

## Overview

A local MCP (Model Context Protocol) server that connects to Proton Bridge via standard IMAP/SMTP protocols. Enables AI assistants (Claude Code, Claude Desktop) to read emails, manage drafts, and organize inbox (labels, folders). Designed to be safe for public sharing and open source.

## Scope

### In scope (v1)

- Read and search emails
- Draft management (save, list, update)
- Inbox organization (move, flags, labels)
- Folder and label management (create, rename, list)
- Pluggable credential providers (env vars, 1Password, ProtonPass)
- Single Proton account

### Explicitly out of scope (v1)

- Sending emails (no send_email, reply, forward) - deferred for safety; will require draft-first flow with confirmation
- Destructive operations (no delete emails, folders, or labels) - deferred for safety
- Multi-account support - deferred; architecture supports later addition
- IDLE/push notifications - deferred
- Proton Calendar/Contacts/Drive integration

## Architecture

Four-layer architecture, each layer depends only on the one below:

```
+-------------------------------------------+
|  MCP Tools Layer                          |  Zod schemas, thin handlers
+-------------------------------------------+
|  Email Operations Layer (services)        |  Business logic
+-------------------------------------------+
|  Connection Manager                       |  IMAP pool + SMTP, reconnect
+-------------------------------------------+
|  Credential Provider                      |  Pluggable: env | 1password | protonpass
+-------------------------------------------+
```

### Dependencies

| Package | Purpose | TypeScript |
|---------|---------|------------|
| `@modelcontextprotocol/sdk` | MCP server framework | Native |
| `zod` | Schema validation (MCP peer dep) | Native |
| `imapflow` | IMAP client | Built-in types |
| `nodemailer` | SMTP transport (for drafts via IMAP APPEND) | `@types/nodemailer` |
| `postal-mime` | RFC822/MIME email parsing | Built-in types |

Note: `nodemailer` is used for composing RFC822 messages for draft creation via IMAP APPEND, not for SMTP sending (sending is out of scope for v1).

### Project Structure

```
proton-bridge-mcp/
  src/
    index.ts                  -- entry point, server bootstrap
    config.ts                 -- Zod-validated config (env + JSON file)
    credentials/
      provider.ts             -- CredentialProvider interface
      env.ts                  -- EnvCredentialProvider
      onepassword.ts          -- OnePasswordProvider (op CLI)
      protonpass.ts           -- ProtonPassProvider (pass-cli)
    connection/
      imap-pool.ts            -- IMAP connection pool with acquire/release
      smtp-client.ts          -- SMTP transport wrapper (for future use)
    services/
      mailbox.service.ts      -- folders & labels CRUD
      message.service.ts      -- list, get, search, headers
      compose.service.ts      -- draft composition (RFC822 message building)
      draft.service.ts        -- save, list, update drafts via IMAP
      organize.service.ts     -- move, flags, labels
    tools/
      reading.ts              -- list_emails, get_email, search_emails, etc.
      composing.ts            -- save_draft, list_drafts, update_draft
      organizing.ts           -- move, mark read/unread, star, labels
      mailbox.ts              -- folder/label management tools
      connection.ts           -- get_connection_status
    types.ts                  -- shared type definitions
    errors.ts                 -- structured error hierarchy
  package.json
  tsconfig.json
  config.example.json
```

## Credential Provider Layer

### Interface

```typescript
interface CredentialProvider {
  getCredentials(): Promise<{ username: string; password: string }>;
}
```

### Implementations

| Provider | Config key | How it works | Auth mechanism |
|----------|-----------|-------------|----------------|
| `env` (default) | `"env"` | Reads `PROTON_BRIDGE_USERNAME` / `PROTON_BRIDGE_PASSWORD` env vars | None |
| `onepassword` | `"onepassword"` | Shells out to `op read "op://vault/item/field"` | Touch ID or `OP_SERVICE_ACCOUNT_TOKEN` |
| `protonpass` | `"protonpass"` | Shells out to `pass-cli item view "pass://vault/item/field"` | `PROTON_PASS_PASSWORD` env var |

Credentials are fetched once at startup, cached in memory for the session lifetime. Never logged, never included in error messages.

### Provider selection

Via `CREDENTIAL_PROVIDER` env var or `credentials.provider` in config file. Defaults to `"env"`.

## Connection Manager

### IMAP Connection Pool

- Configurable pool size (default 3, max 10)
- `acquire(): Promise<ImapFlow>` / `release(client: ImapFlow): void`
- `withConnection<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T>` - auto acquire/release
- `withMailbox<T>(folder: string, fn: (client: ImapFlow) => Promise<T>): Promise<T>` - auto acquire, open mailbox, release
- Auto-reconnect on connection drop (exponential backoff)
- Idle connection cleanup with configurable timeout
- Lazy initialization: connections created on first tool call, not at server startup
- Timeouts: `commandTimeout` (default 30s), `acquireTimeout` (default 10s), `idleTimeout` (default 300s)

### IMAP Connection Config

```typescript
{
  host: '127.0.0.1',
  port: 1143,
  secure: false,          // Bridge uses STARTTLS on port 1143, not implicit TLS
  tls: { rejectUnauthorized: false },  // Bridge self-signed cert
  auth: { user: credentials.username, pass: credentials.password }
}
```

### SMTP Transport (for future use)

Reserved for v2 when sending is implemented. Not initialized in v1.

## Email Operations Layer

### MessageService

- `listEmails(folder, limit, offset)` - Returns metadata only: uid, subject, from, to, date, flags, hasAttachments. No body content. Uses IMAP FETCH with ENVELOPE + FLAGS + BODYSTRUCTURE.
- `getEmail(folder, uid, includeAttachments)` - Full email: headers, text body, HTML body, optionally attachment content. Fetches raw source via IMAP, parses with postal-mime.
- `getEmailHeaders(folder, uid)` - Headers only (subject, from, to, cc, date, message-id, in-reply-to, references). Lightweight.
- `searchEmails(folder, criteria, limit, offset)` - IMAP SEARCH with criteria: from, to, subject, body, since, before, hasAttachment, isUnread. Returns metadata (same as listEmails). Supports pagination via limit/offset.
- `getUnreadCount(folder)` - IMAP STATUS UNSEEN count.

### DraftService

- `saveDraft(to, subject, body, html, attachments)` - Builds RFC822 message using nodemailer's `createTransport().sendMail()` in "stream" mode (or `MailComposer`), then IMAP APPENDs to Drafts folder with `\Draft` flag.
- `listDrafts(limit, offset)` - Lists emails in Drafts folder (delegates to MessageService).
- `updateDraft(uid, fields)` - Replaces draft by deleting the old version and creating a new one with updated fields (IMAP has no edit-in-place). Exception to the no-delete policy: draft replacement is the standard IMAP draft workflow and only affects the user's own draft-in-progress, not received emails.

### OrganizeService

- `moveEmails(folder, uids, destination)` - IMAP MOVE command.
- `setFlags(folder, uids, flags, operation)` - Add/remove IMAP flags (\Seen, \Flagged, \Answered).
- `applyLabels(folder, uids, labels)` - IMAP COPY to `Labels/<name>` (not MOVE - preserves original location).
- `removeLabels(folder, uids, labels)` - Resolves Message-IDs from UIDs in the source folder, then removes the COPY from each `Labels/<name>` folder. This is not a destructive delete of the email itself -- the original message remains in its source folder. Only the label association (the IMAP COPY in the label folder) is removed. Note: UIDs are folder-specific in IMAP, so cross-folder operations require Message-ID lookup.

### MailboxService

- `listFolders()` - IMAP LIST, returns all folders with path, delimiter, specialUse flag, and type (system/folder/label).
- `listLabels()` - Filters listFolders() to `Labels/*` entries.
- `createFolder(name, parent?)` - IMAP CREATE under `Folders/`.
- `renameFolder(oldName, newName)` - IMAP RENAME.
- `createLabel(name)` - IMAP CREATE under `Labels/`.

## MCP Tools

### Reading (5 tools)

**list_emails**
- Description: "List emails from a folder with pagination. Returns metadata only (subject, sender, date, flags)."
- Params: `folder` (string, default "INBOX"), `limit` (number, 1-100, default 20), `offset` (number, default 0)

**get_email**
- Description: "Get a full email by UID including body content."
- Params: `folder` (string), `uid` (number), `include_attachments` (boolean, default false)

**get_email_headers**
- Description: "Get email headers only. Lightweight alternative to get_email."
- Params: `folder` (string), `uid` (number)

**search_emails**
- Description: "Search emails with criteria. Returns metadata for matching emails."
- Params: `folder` (string, default "INBOX"), `from` (string?), `to` (string?), `subject` (string?), `body` (string?), `since` (string? ISO date), `before` (string? ISO date), `has_attachment` (boolean?), `is_unread` (boolean?), `limit` (number, 1-100, default 20), `offset` (number, default 0)

**get_unread_count**
- Description: "Get unread email count for a folder."
- Params: `folder` (string, default "INBOX")

### Composing (3 tools)

**save_draft**
- Description: "Save an email as a draft. Does not send."
- Params: `to` (string[]), `subject` (string), `body` (string), `html` (string?), `from` (string? - for accounts with aliases), `cc` (string[]?), `bcc` (string[]?), `in_reply_to` (string? - Message-ID for threading), `references` (string[]? - Message-ID chain for threading), `attachments` ({filename, content_base64, content_type}[]?)

**list_drafts**
- Description: "List all drafts."
- Params: `limit` (number, 1-100, default 20), `offset` (number, default 0)

**update_draft**
- Description: "Update an existing draft. Replaces the draft with updated content."
- Params: `uid` (number), `to` (string[]?), `subject` (string?), `body` (string?), `html` (string?), `cc` (string[]?), `bcc` (string[]?), `attachments` ({filename, content_base64, content_type}[]?)

### Organizing (7 tools)

**move_emails**
- Description: "Move emails to a different folder."
- Params: `folder` (string), `uids` (number[]), `destination` (string)

**mark_as_read**
- Description: "Mark emails as read."
- Params: `folder` (string), `uids` (number[])

**mark_as_unread**
- Description: "Mark emails as unread."
- Params: `folder` (string), `uids` (number[])

**star_email**
- Description: "Star/flag emails."
- Params: `folder` (string), `uids` (number[])

**unstar_email**
- Description: "Remove star/flag from emails."
- Params: `folder` (string), `uids` (number[])

**apply_labels**
- Description: "Apply labels to emails. Preserves original folder location."
- Params: `folder` (string), `uids` (number[]), `labels` (string[])

**remove_labels**
- Description: "Remove labels from emails. Only removes the label association; the original email remains in its folder."
- Params: `folder` (string), `uids` (number[]), `labels` (string[])

### Mailbox Management (5 tools)

**list_folders**
- Description: "List all folders and their properties."
- Params: none

**create_folder**
- Description: "Create a new folder."
- Params: `name` (string), `parent` (string?)

**rename_folder**
- Description: "Rename an existing folder. Cannot rename system folders."
- Params: `old_name` (string), `new_name` (string)

**list_labels**
- Description: "List all labels."
- Params: none

**create_label**
- Description: "Create a new label."
- Params: `name` (string)

### Connection (1 tool)

**get_connection_status**
- Description: "Check IMAP connection health and pool statistics."
- Params: none
- Returns: actual connection state (connected, pool stats, last error)

## Error Handling

### Error hierarchy

```typescript
class ProtonBridgeError extends Error {
  type: ErrorType;
  suggestions: string[];
}

enum ErrorType {
  CONNECTION = 'connection',
  AUTH = 'auth',
  MAILBOX = 'mailbox',
  CREDENTIAL = 'credential',
  VALIDATION = 'validation',
}
```

### Error mapping

| Raw error | ErrorType | Suggestions |
|-----------|----------|-------------|
| ECONNREFUSED | CONNECTION | "Ensure Proton Bridge is running", "Check IMAP port (default 1143)" |
| AUTH failure | AUTH | "Check Bridge password (not your Proton account password)", "Regenerate Bridge password in Bridge app" |
| Mailbox not found | MAILBOX | "Run list_folders to see available folders" |
| op/pass-cli failure | CREDENTIAL | "Ensure 1Password CLI is installed and authenticated", "Run 'op signin' first" |
| Zod validation | VALIDATION | Field-specific messages from Zod |

### Tool response format

```typescript
// Success
{ content: [{ type: "text", text: JSON.stringify(result) }] }

// Error
{
  content: [{
    type: "text",
    text: JSON.stringify({
      error: true,
      errorType: "connection",
      message: "Cannot connect to Proton Bridge",
      suggestions: ["Ensure Proton Bridge is running", "Check port 1143"],
    })
  }],
  isError: true,
}
```

## Configuration

### Config file (config.json)

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

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROTON_BRIDGE_USERNAME` | - | Bridge account username |
| `PROTON_BRIDGE_PASSWORD` | - | Bridge-generated password |
| `PROTON_BRIDGE_IMAP_HOST` | `127.0.0.1` | IMAP host |
| `PROTON_BRIDGE_IMAP_PORT` | `1143` | IMAP port |
| `PROTON_BRIDGE_SMTP_HOST` | `127.0.0.1` | SMTP host |
| `PROTON_BRIDGE_SMTP_PORT` | `1025` | SMTP port |
| `PROTON_BRIDGE_CONFIG` | `./config.json` | Config file path |
| `CREDENTIAL_PROVIDER` | `env` | Provider: env, onepassword, protonpass |
| `OP_USERNAME_REF` | - | 1Password secret reference for username |
| `OP_PASSWORD_REF` | - | 1Password secret reference for password |
| `PP_USERNAME_REF` | - | ProtonPass secret reference for username |
| `PP_PASSWORD_REF` | - | ProtonPass secret reference for password |

Config resolution: env vars -> config file -> defaults. (Environment variables take precedence, following 12-factor app conventions. This ensures MCP server `env` config always works even if a config.json exists.)

### Claude Code integration

Minimal (env vars only):
```json
{
  "mcpServers": {
    "proton-bridge": {
      "command": "node",
      "args": ["/path/to/proton-bridge-mcp/dist/index.js"],
      "env": {
        "PROTON_BRIDGE_USERNAME": "user@proton.me",
        "PROTON_BRIDGE_PASSWORD": "bridge-password-here"
      }
    }
  }
}
```

With 1Password (no secrets in config):
```json
{
  "mcpServers": {
    "proton-bridge": {
      "command": "node",
      "args": ["/path/to/proton-bridge-mcp/dist/index.js"],
      "env": {
        "CREDENTIAL_PROVIDER": "onepassword",
        "OP_USERNAME_REF": "op://Private/ProtonBridge/username",
        "OP_PASSWORD_REF": "op://Private/ProtonBridge/password"
      }
    }
  }
}
```

## Security Considerations

- No sending capability in v1 - prevents unauthorized email dispatch
- No delete capability in v1 - prevents data loss
- Credentials never logged, never included in error responses
- Bridge password is not the Proton account password (limited blast radius)
- Self-signed TLS cert accepted only for localhost connections
- Credential provider shells out to `op`/`pass-cli` which handle their own auth (biometric, tokens)
- All tool inputs validated with Zod before reaching IMAP

## Proton Bridge Quirks to Handle

| Quirk | How we handle it |
|-------|-----------------|
| Self-signed TLS cert | `tls: { rejectUnauthorized: false }` - only for 127.0.0.1 |
| Labels use COPY not MOVE | `apply_labels` uses IMAP COPY; documented in tool descriptions |
| Messages appear in multiple label folders | Single-folder listing only in v1; deduplication deferred to v2 multi-folder search |
| Sent folder APPEND filtered | Not relevant for v1 (no sending) |
| No CONDSTORE/QRESYNC | Pool reconnects do full folder resync |
| Connection drops kill IMAP server | Connection pool detects and reconnects with backoff |
| UIDs are folder-specific | `remove_labels` uses Message-ID for cross-folder operations |

## Future Additions (v2+)

- **Sending with draft-first flow**: send_email saves draft, returns draft UID; separate confirm_send tool actually sends. Requires explicit config opt-in.
- **Delete operations**: With confirmation patterns or config flags.
- **Multi-account**: Connection manager becomes a map of account -> pool. Tools gain optional `account` parameter.
- **IDLE notifications**: Background IDLE connection emits events for new emails.
- **Thread/conversation grouping**: Group emails by In-Reply-To/References headers.
