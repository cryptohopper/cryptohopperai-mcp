# cryptohopperai-mcp

Model Context Protocol server for the [Cryptohopper.AI](https://www.cryptohopper.ai) API — lets Claude Desktop, Cursor, Zed, and any other MCP-aware LLM host build, poll, and refine Cryptohopper.AI crypto projects on the user's behalf.

It bundles a vendored Cryptohopper.AI SDK and exposes a curated subset of its surface as MCP tools — the package is fully self-contained and installs straight from GitHub (no npm registry needed).

## Tools

| Tool                 | What it does                                      |
|----------------------|---------------------------------------------------|
| `list_projects`        | List every project you have access to             |
| `get_project`          | Fetch a project by id or subdomain                |
| `project_status`       | Cheap status snapshot — safe to poll              |
| `create_project`       | Kick off a new build from a natural-language prompt |
| `refine_project`       | Send a refinement message to an existing project  |
| `wait_for_live`        | Block until the project reaches a terminal state  |
| `cancel_project`       | Stop a queued or in-progress build                |
| `reactivate_project`   | Resume a cancelled / archived project             |
| `get_conversations`    | Read a project's message timeline (prompts + replies + deploy markers) |
| `check_subdomain`      | Is a given slug available?                        |
| `suggest_subdomain`    | Generate a friendly slug from a prompt            |
| `list_secrets`         | List secret keys on a project (names only)        |
| `set_secret`           | Create/overwrite a project secret                 |
| `remove_secret`        | Delete a project secret                           |
| `list_library_projects`| Browse the public project library                 |
| `clone_library_project`| Duplicate a library project into the user's account |
| `usage_summary`        | Plan limits + current-period credit / build / storage usage |
| `current_subscription` | Plan tier + credit balance (price, billing period, current/rolled-over credits) |
| `list_api_keys`        | List the user's API keys (never returns the raw secret) |
| `create_api_key`       | Mint a new API key — raw secret returned ONCE     |
| `remove_api_key`       | Revoke an API key by id or name                   |
| `upload_from_path`     | Read a local file, presign + upload to S3, return an attachment ref |
| `whoami`               | Show the authenticated user                       |

## Configuration

Grab an API key from [https://www.cryptohopper.ai/account/api-keys](https://www.cryptohopper.ai/account/api-keys) (a Hero subscription is required to mint keys). Keys look like `flp_...`.

The server reads `CRYPTOHOPPER_API_KEY` from the environment. Optionally override `CRYPTOHOPPER_API_URL` to point at a staging host.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%AppData%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "cryptohopper": {
      "command": "npx",
      "args": ["-y", "github:cryptohopper/cryptohopperai-mcp"],
      "env": { "CRYPTOHOPPER_API_KEY": "flp_your_key" }
    }
  }
}
```

Restart Claude Desktop; the tools show up under the 🔌 icon.

### Cursor

`~/.cursor/mcp.json` (or Cursor Settings → Tools & Integrations → MCP):

```json
{
  "mcpServers": {
    "cryptohopper": {
      "command": "npx",
      "args": ["-y", "github:cryptohopper/cryptohopperai-mcp"],
      "env": { "CRYPTOHOPPER_API_KEY": "flp_your_key" }
    }
  }
}
```

### Generic MCP host

Any host that speaks the MCP stdio transport can run the server:

```bash
CRYPTOHOPPER_API_KEY=flp_your_key npx -y github:cryptohopper/cryptohopperai-mcp
```

## Usage notes

- **`create_project`** starts a build right away. Follow up with `wait_for_live` (blocks) or `project_status` (poll) to know when it's up.
- **`wait_for_live`** defaults to a 10-minute ceiling (bounded by `timeoutMs`, capped at 30 min). Most builds finish in under two minutes.
- **`upload_from_path` → `refine_project`** is the canonical attachment flow: call `upload_from_path` with a local file, get back an `UploadedAttachment` (`{key, fileName, fileType, fileSize}`), then pass it as `attachments: [<that object>]` on `refine_project`. The LLM host's process needs read access to the file path; max 5 MB.
- **`refine_project` `codeEditOnly: true`** runs a 3-step in-place patch instead of a full 6-step rebuild and charges roughly half the credits — use it for copy edits, colour swaps, or typo fixes on a project that's already live. The backend won't promote a code-edit to a full refinement automatically, so prefer plain `refine_project` when the change actually needs redesign.
- **`cancel_project` → `reactivate_project`** is the abort/redo pattern. `cancel_project` is `destructiveHint: true`; hosts should confirm before calling it. `reactivate_project` triggers a fresh build at the project's most recent prompt.
- **`set_secret` / `remove_secret`** are marked `destructiveHint: true` — hosts may ask the user to confirm before they run.
- **`list_secrets`** only returns names, never values. Secret values cannot be retrieved once written; rotate them by re-setting.
- On failure, tools return an MCP `isError` content result rather than tearing down the session, so the host displays the error to the user.

## Development

```bash
git clone https://github.com/cryptohopper/cryptohopperai-mcp.git
cd cryptohopperai-mcp
npm install
npm run typecheck
npm run build

CRYPTOHOPPER_API_KEY=flp_your_key node dist/index.js
```

The Cryptohopper.AI SDK is vendored under `src/sdk/` and bundled into `dist/index.js` by [tsup](https://tsup.egoist.dev/), so the package has no runtime dependency on a separate SDK. `dist/` is committed so the server can be run directly from GitHub via `npx github:cryptohopper/cryptohopperai-mcp`.

To smoke-test the stdio handshake without an LLM host:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | CRYPTOHOPPER_API_KEY=flp_dummy node dist/index.js 2>/dev/null
```

## Docs

API reference: [https://www.cryptohopper.ai/docs/api-overview](https://www.cryptohopper.ai/docs/api-overview)

## License

MIT © Cryptohopper B.V.
