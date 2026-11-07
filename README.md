# proton-bridge-mcp

MCP server for Proton Mail via Proton Bridge. Connects AI assistants (Claude Code, Claude Desktop) to your Proton Mail account using standard IMAP over the locally-running Proton Bridge application.

## What it does

Exposes 24 MCP tools that let an AI assistant read and search your email, manage drafts, send emails and replies, organize your inbox (move, flag, label), and manage folders and labels. Deleting emails is intentionally excluded for safety.

## HTTP mode

With `MCP_HTTP_PORT` set, the server speaks stateless Streamable HTTP on `POST /mcp` instead of stdio. It has no authentication, so run it only on a private network behind an authenticating proxy. `PROTON_MCP_NO_SEND=1` leaves out `send_email` and `send_reply`.

## Requirements

- Node.js 20 or later
- [Proton Bridge](https://proton.me/mail/bridge) running locally (requires a Proton Mail paid plan)
- The Bridge-generated IMAP password (not your Proton account password)

## Installation

```bash
git clone https://github.com/honzapav/proton-bridge-mcp.git
cd proton-bridge-mcp
npm install
npm run build
```

The compiled entry point is `dist/index.js`.

## Configuration

Configuration is resolved in this order: **environment variables > config.json > built-in defaults**.

### Option 1: Environment variables (simplest)

Set two variables before running the server:

```bash
export PROTON_BRIDGE_USERNAME="user@proton.me"
export PROTON_BRIDGE_PASSWORD="bridge-generated-password"
```

### Option 2: config.json file

Copy the example and edit it:

```bash
cp config.example.json config.json
```

```json
{
  "credentials": {
    "provider": "env"
  },
  "imap": {
    "host": "127.0.0.1",
    "port": 1143,
    "poolSize": 3,
    "commandTimeout": 30000,
    "acquireTimeout": 10000,
    "idleTimeout": 300000
  }
}
```

Point to a custom config file with `PROTON_BRIDGE_CONFIG=/path/to/config.json`.

### Option 3: 1Password

Store the Bridge credentials in 1Password and reference them by secret reference URI:

```json
{
  "credentials": {
    "provider": "onepassword",
    "onepassword": {
      "username_ref": "op://Personal/Proton Bridge/username",
      "password_ref": "op://Personal/Proton Bridge/password"
    }
  }
}
```

Or pass the references as environment variables (no config file needed):

```bash
export CREDENTIAL_PROVIDER=onepassword
export OP_USERNAME_REF="op://Personal/Proton Bridge/username"
export OP_PASSWORD_REF="op://Personal/Proton Bridge/password"
```

Requires the [1Password CLI (`op`)](https://developer.1password.com/docs/cli/) to be installed and authenticated.

If you have multiple 1Password accounts, set `OP_ACCOUNT` to the account ID or sign-in address for the account containing your Proton credentials. The `op` CLI reads this env var automatically.

### Option 4: ProtonPass

```json
{
  "credentials": {
    "provider": "protonpass",
    "protonpass": {
      "username_ref": "proton/bridge/username",
      "password_ref": "proton/bridge/password"
    }
  }
}
```

Or via environment variables:

```bash
export CREDENTIAL_PROVIDER=protonpass
export PP_USERNAME_REF="proton/bridge/username"
export PP_PASSWORD_REF="proton/bridge/password"
```

Requires `pass-cli` to be installed and the `PROTON_PASS_PASSWORD` env var set.

### Option 5: macOS Keychain

Store the Bridge credentials as generic password items in the macOS Keychain, one item per value:

```bash
security add-generic-password -s mcp.proton.email -a proton-bridge-mcp -w "user@proton.me"
security add-generic-password -s mcp.proton.password -a proton-bridge-mcp -w "bridge-generated-password"
```

```json
{
  "credentials": {
    "provider": "keychain",
    "keychain": {
      "username_service": "mcp.proton.email",
      "password_service": "mcp.proton.password"
    }
  }
}
```

Or via environment variables:

```bash
export CREDENTIAL_PROVIDER=keychain
export KEYCHAIN_USERNAME_SERVICE="mcp.proton.email"
export KEYCHAIN_PASSWORD_SERVICE="mcp.proton.password"
```

The server reads each item with `security find-generic-password -s <service> -w`. If several items share the same service name, set `KEYCHAIN_ACCOUNT` (or `keychain.account` in the config file) to disambiguate by account name (`-a`). macOS only.

### All environment variables

| Variable | Default | Description |
|---|---|---|
| `PROTON_BRIDGE_USERNAME` | - | Bridge account username |
| `PROTON_BRIDGE_PASSWORD` | - | Bridge-generated IMAP password |
| `PROTON_BRIDGE_IMAP_HOST` | `127.0.0.1` | IMAP host |
| `PROTON_BRIDGE_IMAP_PORT` | `1143` | IMAP port |
| `PROTON_BRIDGE_SMTP_HOST` | `127.0.0.1` | SMTP host |
| `PROTON_BRIDGE_SMTP_PORT` | `1025` | SMTP port |
| `PROTON_BRIDGE_CONFIG` | `./config.json` | Path to config file |
| `CREDENTIAL_PROVIDER` | `env` | `env`, `onepassword`, `protonpass`, or `keychain` |
| `OP_ACCOUNT` | - | 1Password account ID or sign-in address (needed only with multiple accounts) |
| `OP_USERNAME_REF` | - | 1Password secret reference for username |
| `OP_PASSWORD_REF` | - | 1Password secret reference for password |
| `PP_USERNAME_REF` | - | ProtonPass secret reference for username |
| `PP_PASSWORD_REF` | - | ProtonPass secret reference for password |
| `KEYCHAIN_USERNAME_SERVICE` | - | macOS Keychain service name (`-s`) of the item holding the username |
| `KEYCHAIN_PASSWORD_SERVICE` | - | macOS Keychain service name (`-s`) of the item holding the password |
| `KEYCHAIN_ACCOUNT` | - | macOS Keychain account name (`-a`); optional, only to disambiguate items |

## Claude Code / Claude Desktop integration

Add one of the following blocks to your MCP configuration file.

**Claude Code** (`~/.claude/claude_code_config.json` or via `claude mcp add`):

**Minimal - env vars only:**
```json
{
  "mcpServers": {
    "proton-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/proton-bridge-mcp/dist/index.js"],
      "env": {
        "PROTON_BRIDGE_USERNAME": "user@proton.me",
        "PROTON_BRIDGE_PASSWORD": "bridge-password-here"
      }
    }
  }
}
```

**With 1Password (no secrets in config):**
```json
{
  "mcpServers": {
    "proton-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/proton-bridge-mcp/dist/index.js"],
      "env": {
        "CREDENTIAL_PROVIDER": "onepassword",
        "OP_USERNAME_REF": "op://Personal/Proton Bridge/username",
        "OP_PASSWORD_REF": "op://Personal/Proton Bridge/password"
      }
    }
  }
}
```

**Claude Desktop** uses the same JSON structure, placed in:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## Available tools

### Reading (5 tools)

| Tool | Description |
|---|---|
| `list_emails` | List emails from a folder with pagination. Returns metadata only (subject, sender, date, flags). |
| `get_email` | Get a full email by UID including body content. |
| `get_email_headers` | Get email headers only. Lightweight alternative to `get_email`. |
| `search_emails` | Search emails with criteria (from, to, subject, body, date range, attachment, read status). |
| `get_unread_count` | Get unread email count for a folder. |

### Composing / Drafts (4 tools)

| Tool | Description |
|---|---|
| `save_draft` | Save an email as a draft. Does not send. Supports aliases, CC, BCC, reply threading, and attachments. |
| `save_reply_draft` | Create a reply draft to an existing email. Handles threading automatically (In-Reply-To, References, subject prefix). |
| `list_drafts` | List all drafts with pagination. |
| `update_draft` | Replace an existing draft with updated content. |

### Sending (2 tools)

| Tool | Description |
|---|---|
| `send_email` | Send a new email via SMTP. Sends immediately, does not save a draft. |
| `send_reply` | Send a reply to an existing email via SMTP. Threading is handled automatically. Sends immediately. |

### Organizing (7 tools)

| Tool | Description |
|---|---|
| `move_emails` | Move emails to a different folder. |
| `mark_as_read` | Mark emails as read. |
| `mark_as_unread` | Mark emails as unread. |
| `star_email` | Star/flag emails. |
| `unstar_email` | Remove star/flag from emails. |
| `apply_labels` | Apply labels to emails. Preserves original folder location. |
| `remove_labels` | Remove labels from emails. Original email remains in its folder. |

### Mailbox management (5 tools)

| Tool | Description |
|---|---|
| `list_folders` | List all folders and their properties. |
| `create_folder` | Create a new folder. |
| `rename_folder` | Rename an existing folder. Cannot rename system folders. |
| `list_labels` | List all labels. |
| `create_label` | Create a new label. |

### Connection (1 tool)

| Tool | Description |
|---|---|
| `get_connection_status` | Check IMAP connection health and pool statistics. |

## Security

- **Sending is explicit.** `send_email` and `send_reply` dispatch mail immediately via SMTP — grant them to your assistant deliberately. All other composing tools only create drafts.
- **No delete capability.** Received emails and folders cannot be deleted. (`update_draft` replaces a draft in-place, which is the standard IMAP draft workflow and only affects your own in-progress drafts.)
- **Credentials are never logged** and never included in error messages or tool responses.
- The Bridge password is a Bridge-generated token, not your Proton account password, limiting blast radius if it is ever exposed.
- The self-signed TLS certificate is accepted only for connections to `127.0.0.1` (localhost).
- All tool inputs are validated with Zod before any IMAP command is issued.

## Development

```bash
# Run tests
npm test

# Watch mode for tests
npm run test:watch

# Compile TypeScript
npm run build

# Watch mode for compilation
npm run dev
```

## License

MIT
