import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const execFileAsync = promisify(execFile);

// ── Normalized types ──────────────────────────────────────────────────────────

export interface RateWindow {
  label: string;          // "5h session", "7d", "weekly", etc.
  percentUsed: number;    // 0–100
  percentRemaining: number;
  resetsAt?: string;      // ISO 8601
}

export interface ProviderStatus {
  name: "Claude" | "Codex" | "Copilot";
  available: boolean;     // false = currently rate limited
  rateLimited: boolean;
  error?: string;         // if the CLI failed
  primaryWindow?: RateWindow;   // most relevant short-term window
  secondaryWindow?: RateWindow; // secondary window if present
  raw?: unknown;
}

export interface AllProvidersResult {
  claude: ProviderStatus;
  codex: ProviderStatus;
  copilot: ProviderStatus;
}

// ── Command resolution ────────────────────────────────────────────────────────

// In production: packages are installed globally / run via npx.
// In dev (local checkout): sibling dist/cli.js files are used as fallback.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIBLING = resolve(__dirname, "../../");

function resolveCmd(pkg: string, siblingDir: string): [string, string[]] {
  // Env var override: CLAUDE_STATUS_CMD, CODEX_STATUS_CMD, COPILOT_STATUS_CMD
  const envKey = pkg.toUpperCase().replace(/-/g, "_").replace("_MCP", "") + "_STATUS_CMD";
  const envVal = process.env[envKey]?.trim();
  if (envVal) {
    const parts = envVal.split(" ");
    return [parts[0], parts.slice(1)];
  }

  // Default: npx -y <package-name>
  return ["npx", ["-y", pkg]];
}

// ── Spawn a provider CLI and parse its JSON ───────────────────────────────────

async function spawnProvider(pkg: string, siblingDir: string, timeoutMs: number): Promise<unknown> {
  const [cmd, args] = resolveCmd(pkg, siblingDir);
  const { stdout } = await execFileAsync(cmd, args, {
    timeout: timeoutMs,
    env: { ...process.env },
  });
  return JSON.parse(stdout.trim());
}

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeClaude(raw: unknown): ProviderStatus {
  const d = raw as {
    usage?: {
      five_hour?: { utilization?: number; resets_at?: string };
      seven_day?: { utilization?: number; resets_at?: string };
      seven_day_sonnet?: { utilization?: number; resets_at?: string } | null;
    };
  };

  const fh = d.usage?.five_hour;
  const sd = d.usage?.seven_day;

  const primaryWindow: RateWindow | undefined = fh
    ? {
        label: "5h",
        percentUsed: fh.utilization ?? 0,
        percentRemaining: 100 - (fh.utilization ?? 0),
        resetsAt: fh.resets_at,
      }
    : undefined;

  const secondaryWindow: RateWindow | undefined = sd
    ? {
        label: "7d",
        percentUsed: sd.utilization ?? 0,
        percentRemaining: 100 - (sd.utilization ?? 0),
        resetsAt: sd.resets_at,
      }
    : undefined;

  const rateLimited = (fh?.utilization ?? 0) >= 100 || (sd?.utilization ?? 0) >= 100;

  return {
    name: "Claude",
    available: !rateLimited,
    rateLimited,
    primaryWindow,
    secondaryWindow,
    raw,
  };
}

function normalizeCodex(raw: unknown): ProviderStatus {
  const d = raw as {
    rateLimits?: {
      primary?: { usedPercent?: number; resetsAtIso?: string; windowDurationMins?: number };
      secondary?: { usedPercent?: number; resetsAtIso?: string; windowDurationMins?: number };
      rateLimitReachedType?: string | null;
    };
  };

  const p = d.rateLimits?.primary;
  const s = d.rateLimits?.secondary;
  const rateLimited = d.rateLimits?.rateLimitReachedType != null;

  function windowLabel(mins?: number): string {
    if (!mins) return "window";
    if (mins === 300) return "5h";
    if (mins === 10080) return "7d";
    return `${Math.round(mins / 60)}h`;
  }

  const primaryWindow: RateWindow | undefined = p
    ? {
        label: windowLabel(p.windowDurationMins),
        percentUsed: p.usedPercent ?? 0,
        percentRemaining: 100 - (p.usedPercent ?? 0),
        resetsAt: p.resetsAtIso,
      }
    : undefined;

  const secondaryWindow: RateWindow | undefined = s
    ? {
        label: windowLabel(s.windowDurationMins),
        percentUsed: s.usedPercent ?? 0,
        percentRemaining: 100 - (s.usedPercent ?? 0),
        resetsAt: s.resetsAtIso,
      }
    : undefined;

  return {
    name: "Codex",
    available: !rateLimited,
    rateLimited,
    primaryWindow,
    secondaryWindow,
    raw,
  };
}

function normalizeCopilot(raw: unknown): ProviderStatus {
  const d = raw as {
    shortTermRateLimit?: {
      rateLimited?: boolean;
      sessionResetsAt?: string;
      session?: { percentUsed?: number; percentRemaining?: number; resetsAt?: string };
      weekly?: { percentUsed?: number; percentRemaining?: number; resetsAt?: string };
    };
  };

  const stl = d.shortTermRateLimit;
  const rateLimited = stl?.rateLimited ?? false;

  const primaryWindow: RateWindow | undefined = stl?.session
    ? {
        label: "5h session",
        percentUsed: stl.session.percentUsed ?? 0,
        percentRemaining: stl.session.percentRemaining ?? 0,
        resetsAt: stl.session.resetsAt,
      }
    : rateLimited && stl?.sessionResetsAt
      ? { label: "5h session", percentUsed: 100, percentRemaining: 0, resetsAt: stl.sessionResetsAt }
      : undefined;

  const secondaryWindow: RateWindow | undefined = stl?.weekly
    ? {
        label: "weekly",
        percentUsed: stl.weekly.percentUsed ?? 0,
        percentRemaining: stl.weekly.percentRemaining ?? 0,
        resetsAt: stl.weekly.resetsAt,
      }
    : undefined;

  return {
    name: "Copilot",
    available: !rateLimited,
    rateLimited,
    primaryWindow,
    secondaryWindow,
    raw,
  };
}

// ── Main fetch ────────────────────────────────────────────────────────────────

export interface FetchOptions {
  timeoutMs?: number;
}

async function fetchOne(
  pkg: string,
  normalize: (raw: unknown) => ProviderStatus,
  timeoutMs: number,
): Promise<ProviderStatus> {
  try {
    const raw = await spawnProvider(pkg, SIBLING, timeoutMs);
    return normalize(raw);
  } catch (err) {
    const name = pkg.replace("-status-mcp", "").replace("claude-usage-mcp", "claude");
    const capitalized = (name.charAt(0).toUpperCase() + name.slice(1)) as ProviderStatus["name"];
    return {
      name: capitalized,
      available: false,
      rateLimited: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchAllProviders(options: FetchOptions = {}): Promise<AllProvidersResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;

  const [claude, codex, copilot] = await Promise.all([
    fetchOne("claude-status-mcp", normalizeClaude, timeoutMs),
    fetchOne("codex-status-mcp", normalizeCodex, timeoutMs),
    fetchOne("copilot-status-mcp", normalizeCopilot, timeoutMs),
  ]);

  return { claude, codex, copilot };
}
