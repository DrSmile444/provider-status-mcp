# provider-status-mcp

Aggregate Claude, Codex, and Copilot status into a single view — for both humans and LLMs.

`provider-status-mcp` collects quota and rate-limit status from all three AI providers at once and
presents them together. Use it to quickly see which providers are available before choosing one, or
give an LLM a single tool that tells it which AI backends it can reach right now.

```sh
claude mcp add --scope user provider-status-mcp -- npx -y provider-status-mcp --mcp
```

## Features

- Fetches Claude, Codex, and Copilot status in parallel.
- Quick-glance box at the top showing all three providers at once with progress bars.
- `--pretty` flag for a detailed human-readable summary.
- Single MCP tool `get_provider_status` — lets an LLM check all providers in one call.
- Graceful degradation: a provider that fails or isn't configured is shown as unavailable.
- Each provider's CLI is invoked separately — no cross-provider coupling.

## Quick Start

```sh
npx provider-status-mcp --pretty
```

```
╔══════════════════════════════════════════════════════════════╗
║  Provider Status — Quick Glance                              ║
╠══════════════════════════════════════════════════════════════╣
║  Claude   ✅  [██░░░░░░░░░░░░░]  13% used (5h) · resets 4h 36m ║
║  Codex    ✅  [████████░░░░░░░]  56% used (5h) · resets 4h 42m ║
║  Copilot  ⛔  RATE LIMITED · resets 66h 6m                     ║
╚══════════════════════════════════════════════════════════════╝

━━━ Claude ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  Available
  5h:  13.0% used  [███░░░░░░░░░░░░░░░░░]  87.0% remaining  (resets 4h 36m)
  7d:  48.0% used  [██████████░░░░░░░░░░]  52.0% remaining  (resets 25h)
...
```

Add to Claude Code:

```sh
claude mcp add --scope user provider-status-mcp -- npx -y provider-status-mcp --mcp
```

Then ask:

```text
Which AI providers are available right now?
Am I rate limited on any provider?
```

## Requirements

- Node.js 18 or newer.
- At least one of the individual provider packages available via `npx`:
  - `claude-status-mcp`
  - `codex-status-mcp`
  - `copilot-status-mcp`

Each provider is invoked separately. Providers that can't be reached are shown as unavailable
rather than causing the whole command to fail.

## CLI Usage

### Default — JSON output

```sh
npx provider-status-mcp
```

```json
{
  "claude":  { "name": "Claude",  "available": true,  "rateLimited": false, "primaryWindow": { "label": "5h", "percentUsed": 13, "percentRemaining": 87, "resetsAt": "..." }, ... },
  "codex":   { "name": "Codex",   "available": true,  "rateLimited": false, "primaryWindow": { "label": "5h", "percentUsed": 56, "percentRemaining": 44, "resetsAt": "..." }, ... },
  "copilot": { "name": "Copilot", "available": false, "rateLimited": true,  "primaryWindow": { "label": "5h session", "percentUsed": 100, "percentRemaining": 0, "resetsAt": "..." }, ... }
}
```

### Pretty output

```sh
npx provider-status-mcp --pretty
```

### All flags

```sh
npx provider-status-mcp [options]

Options:
  --pretty               Quick-glance box + per-provider details.
  --timeout-ms <ms>      Per-provider timeout in milliseconds (default: 30000).
  --mcp                  Run as an MCP stdio server.
  --help, -h             Show help.
```

## MCP Setup

The MCP server exposes one tool: `get_provider_status`.

Returns the same JSON as the CLI. Optional arguments:

```json
{ "timeoutMs": 30000 }
```

### Claude Code

```sh
claude mcp add --scope user provider-status-mcp -- npx -y provider-status-mcp --mcp
```

Equivalent MCP JSON:

```json
{
  "mcpServers": {
    "provider-status-mcp": {
      "command": "npx",
      "args": ["-y", "provider-status-mcp", "--mcp"]
    }
  }
}
```

## Provider Command Overrides

By default, each provider is invoked as `npx -y <package-name>`. Override with env vars:

```sh
CLAUDE_STATUS_CMD="node /path/to/claude-status-mcp/dist/cli.js"
CODEX_STATUS_CMD="node /path/to/codex-status-mcp/dist/cli.js"
COPILOT_STATUS_CMD="node /path/to/copilot-status-mcp/dist/cli.js"
```

Useful for local development before the packages are published.

## Local Development

```sh
npm install
npm run build

# With local provider CLIs:
CLAUDE_STATUS_CMD="node ../claude-usage-mcp/dist/cli.js" \
CODEX_STATUS_CMD="node ../codex-status-mcp/dist/cli.js" \
COPILOT_STATUS_CMD="node ../copilot-status-mcp/dist/cli.js" \
node dist/cli.js --pretty
```

## Related Packages

These packages are part of the same family of AI provider status tools:

- [claude-status-mcp](https://github.com/DrSmile444/claude-status-mcp) — Claude OAuth usage and rate-limit windows
- [codex-status-mcp](https://github.com/DrSmile444/codex-status-mcp) — Codex / ChatGPT rate-limit windows and credits
- [copilot-status-mcp](https://github.com/DrSmile444/copilot-status-mcp) — GitHub Copilot session, weekly, and monthly quota

## License

MIT

---

Made with ❤️ by Dmytro Vakulenko, 2026
