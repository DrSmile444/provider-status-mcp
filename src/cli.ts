#!/usr/bin/env node
import { runMcpServer } from "./mcp.js";
import { fetchAllProviders, type AllProvidersResult, type ProviderStatus, type RateWindow } from "./providers.js";

// ── Formatting helpers ────────────────────────────────────────────────────────

function buildBar(usedPercent: number, width = 20): string {
  const filled = Math.round(Math.min(100, Math.max(0, usedPercent)) / 100 * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function humanDiff(isoDate: string): string {
  const diffSecs = Math.round((new Date(isoDate).getTime() - Date.now()) / 1000);
  if (diffSecs <= 0) return "already passed";
  const h = Math.floor(diffSecs / 3600);
  const m = Math.floor((diffSecs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Summary glance bar ────────────────────────────────────────────────────────

function printGlance(result: AllProvidersResult): void {
  const providers = [result.claude, result.codex, result.copilot];
  const maxNameLen = Math.max(...providers.map((p) => p.name.length));

  process.stdout.write("╔══════════════════════════════════════════════════════════════╗\n");
  process.stdout.write("║  Provider Status — Quick Glance                              ║\n");
  process.stdout.write("╠══════════════════════════════════════════════════════════════╣\n");

  for (const p of providers) {
    const namePad = p.name.padEnd(maxNameLen);

    // emoji (⚠ ⛔ ✅) each occupy 2 terminal columns but 1 JS character — subtract 1 per emoji
    const line = (text: string, emojiCount = 1): void => {
      process.stdout.write(`║${text.padEnd(64 - emojiCount)}║\n`);
    };

    if (p.error) {
      line(`  ${namePad}  ⚠  unavailable (${p.error.slice(0, 30)}...)`);
      continue;
    }

    const w = p.primaryWindow;
    if (p.rateLimited) {
      const resetsIn = w?.resetsAt ? ` · resets ${humanDiff(w.resetsAt)}` : "";
      line(`  ${namePad}  ⛔  RATE LIMITED${resetsIn}`);
    } else if (w) {
      const bar = buildBar(w.percentUsed, 15);
      const pct = `${w.percentUsed.toFixed(0)}%`.padStart(4);
      const resetsIn = w.resetsAt ? ` · resets ${humanDiff(w.resetsAt)}` : "";
      line(`  ${namePad}  ✅  ${bar} ${pct} used (${w.label})${resetsIn}`);
    } else {
      line(`  ${namePad}  ✅  available`);
    }
  }

  process.stdout.write("╚══════════════════════════════════════════════════════════════╝\n");
}

// ── Per-provider pretty sections ──────────────────────────────────────────────

function printWindow(label: string, w: RateWindow): void {
  const bar = buildBar(w.percentUsed);
  process.stdout.write(`  ${label.padEnd(16)}${w.percentUsed.toFixed(1)}% used  ${bar}  ${w.percentRemaining.toFixed(1)}% remaining\n`);
  if (w.resetsAt) {
    process.stdout.write(`  ${" ".repeat(16)}resets at ${w.resetsAt} (in ${humanDiff(w.resetsAt)})\n`);
  }
}

function printProviderSection(p: ProviderStatus): void {
  process.stdout.write(`\n━━━ ${p.name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (p.error) {
    process.stdout.write(`  ⚠  Error: ${p.error}\n`);
    return;
  }

  if (p.rateLimited) {
    process.stdout.write("  ⛔  RATE LIMITED\n");
    if (p.primaryWindow?.resetsAt) {
      process.stdout.write(`  Resets in: ${humanDiff(p.primaryWindow.resetsAt)}\n`);
    }
  } else {
    process.stdout.write("  ✅  Available\n");
  }

  if (p.primaryWindow) printWindow(p.primaryWindow.label + ":", p.primaryWindow);
  if (p.secondaryWindow) printWindow(p.secondaryWindow.label + ":", p.secondaryWindow);
}

function printPretty(result: AllProvidersResult): void {
  process.stdout.write("\n");
  printGlance(result);
  printProviderSection(result.claude);
  printProviderSection(result.codex);
  printProviderSection(result.copilot);
  process.stdout.write("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────

interface CliOptions {
  mcp: boolean;
  pretty: boolean;
  timeoutMs?: number;
  help: boolean;
}

function printHelp(): void {
  process.stdout.write(`provider-status-mcp

Aggregate Claude, Codex, and Copilot status into a single view.

Usage:
  provider-status-mcp [options]
  provider-status-mcp --mcp
  provider-status-mcp --help

Options:
  --pretty               Print a human-readable summary with glance bars.
  --timeout-ms <ms>      Per-provider timeout in milliseconds (default: 30000).
  --mcp                  Run as an MCP stdio server.
  --help, -h             Show this help message.

Provider command overrides (env vars):
  CLAUDE_STATUS_CMD      Override the claude-status-mcp command
  CODEX_STATUS_CMD       Override the codex-status-mcp command
  COPILOT_STATUS_CMD     Override the copilot-status-mcp command

  Example: CLAUDE_STATUS_CMD="node /path/to/claude-status-mcp/dist/cli.js"

By default each provider is invoked via: npx -y <package-name>
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mcp: false, pretty: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--mcp":     options.mcp = true; break;
      case "--pretty":  options.pretty = true; break;
      case "--help": case "-h": options.help = true; break;
      case "--timeout-ms": {
        i++;
        if (!argv[i]) throw new Error("--timeout-ms requires a value.");
        const parsed = Number(argv[i]);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--timeout-ms must be a positive number.");
        options.timeoutMs = parsed;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.mcp) {
    await runMcpServer();
    return;
  }

  const result = await fetchAllProviders({ timeoutMs: options.timeoutMs });

  if (options.pretty) {
    printPretty(result);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
