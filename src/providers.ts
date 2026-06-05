import { getClaudeUsage } from "claude-status-mcp";
import { getCodexStatus } from "codex-status-mcp";
import { getCopilotStatus } from "copilot-status-mcp";

// ── Normalized types ──────────────────────────────────────────────────────────

export interface RateWindow {
  label: string;
  percentUsed: number;
  percentRemaining: number;
  resetsAt?: string;  // ISO 8601
}

export interface ProviderStatus {
  name: "Claude" | "Codex" | "Copilot";
  available: boolean;
  rateLimited: boolean;
  error?: string;
  primaryWindow?: RateWindow;
  secondaryWindow?: RateWindow;
  raw?: unknown;
}

export interface AllProvidersResult {
  claude: ProviderStatus;
  codex: ProviderStatus;
  copilot: ProviderStatus;
}

// ── Normalizers ───────────────────────────────────────────────────────────────

async function fetchClaude(timeoutMs: number): Promise<ProviderStatus> {
  try {
    const raw = await Promise.race([
      getClaudeUsage(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Claude timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    type Window = { utilization?: number; resets_at?: string };
    const usage = raw.usage as Record<string, Window | null> | undefined;
    const fh = usage?.five_hour ?? undefined;
    const sd = usage?.seven_day ?? undefined;

    const rateLimited = (fh?.utilization ?? 0) >= 100 || (sd?.utilization ?? 0) >= 100;

    return {
      name: "Claude",
      available: !rateLimited,
      rateLimited,
      primaryWindow: fh
        ? { label: "5h", percentUsed: fh.utilization ?? 0, percentRemaining: 100 - (fh.utilization ?? 0), resetsAt: fh.resets_at }
        : undefined,
      secondaryWindow: sd
        ? { label: "7d", percentUsed: sd.utilization ?? 0, percentRemaining: 100 - (sd.utilization ?? 0), resetsAt: sd.resets_at }
        : undefined,
      raw,
    };
  } catch (err) {
    return { name: "Claude", available: false, rateLimited: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchCodex(timeoutMs: number): Promise<ProviderStatus> {
  try {
    const raw = await Promise.race([
      getCodexStatus({ timeoutMs }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Codex timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    const p = raw.rateLimits?.primary;
    const s = raw.rateLimits?.secondary;
    const rateLimited = raw.rateLimits?.rateLimitReachedType != null;

    function windowLabel(mins?: number): string {
      if (mins === 300) return "5h";
      if (mins === 10080) return "7d";
      return mins ? `${Math.round(mins / 60)}h` : "window";
    }

    return {
      name: "Codex",
      available: !rateLimited,
      rateLimited,
      primaryWindow: p
        ? { label: windowLabel(p.windowDurationMins ?? undefined), percentUsed: p.usedPercent ?? 0, percentRemaining: 100 - (p.usedPercent ?? 0), resetsAt: p.resetsAtIso ?? undefined }
        : undefined,
      secondaryWindow: s
        ? { label: windowLabel(s.windowDurationMins ?? undefined), percentUsed: s.usedPercent ?? 0, percentRemaining: 100 - (s.usedPercent ?? 0), resetsAt: s.resetsAtIso ?? undefined }
        : undefined,
      raw,
    };
  } catch (err) {
    return { name: "Codex", available: false, rateLimited: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchCopilot(timeoutMs: number): Promise<ProviderStatus> {
  try {
    const raw = await Promise.race([
      getCopilotStatus({ timeoutMs }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Copilot timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    const stl = raw.shortTermRateLimit;
    const rateLimited = stl.rateLimited;

    const primaryWindow: RateWindow | undefined = stl.session
      ? { label: "5h session", percentUsed: stl.session.percentUsed, percentRemaining: stl.session.percentRemaining, resetsAt: stl.session.resetsAt }
      : rateLimited && stl.sessionResetsAt
        ? { label: "5h session", percentUsed: 100, percentRemaining: 0, resetsAt: stl.sessionResetsAt }
        : undefined;

    const secondaryWindow: RateWindow | undefined = stl.weekly
      ? { label: "weekly", percentUsed: stl.weekly.percentUsed, percentRemaining: stl.weekly.percentRemaining, resetsAt: stl.weekly.resetsAt }
      : undefined;

    return {
      name: "Copilot",
      available: !rateLimited,
      rateLimited,
      primaryWindow,
      secondaryWindow,
      raw,
    };
  } catch (err) {
    return { name: "Copilot", available: false, rateLimited: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface FetchOptions {
  timeoutMs?: number;
}

export async function fetchAllProviders(options: FetchOptions = {}): Promise<AllProvidersResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;

  const [claude, codex, copilot] = await Promise.all([
    fetchClaude(timeoutMs),
    fetchCodex(timeoutMs),
    fetchCopilot(timeoutMs),
  ]);

  return { claude, codex, copilot };
}
