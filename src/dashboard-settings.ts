import type { AppConfig } from "./config";

export interface DashboardSettings {
  symbols: string[];
  interval: string;
  scanIntervalMs: number;
  minRewardRisk?: number;
}

export const MIN_DASHBOARD_SCAN_INTERVAL_MS = 60_000;
export const MAX_DASHBOARD_SCAN_INTERVAL_MS = 86_400_000;
export const MAX_DASHBOARD_SYMBOLS = 20;
export const MAX_DASHBOARD_REWARD_RISK = 100;

export function isDashboardSettings(value: unknown): value is DashboardSettings {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const settings = value as Record<string, unknown>;
  return (
    Array.isArray(settings.symbols) &&
    settings.symbols.length > 0 &&
    settings.symbols.length <= MAX_DASHBOARD_SYMBOLS &&
    settings.symbols.every(
      (symbol) =>
        typeof symbol === "string" &&
        /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(symbol)
    ) &&
    new Set(settings.symbols).size === settings.symbols.length &&
    typeof settings.interval === "string" &&
    /^\d+(min|h|day|week|month)$/.test(settings.interval) &&
    typeof settings.scanIntervalMs === "number" &&
    Number.isInteger(settings.scanIntervalMs) &&
    settings.scanIntervalMs >= MIN_DASHBOARD_SCAN_INTERVAL_MS &&
    settings.scanIntervalMs <= MAX_DASHBOARD_SCAN_INTERVAL_MS &&
    (settings.minRewardRisk === undefined ||
      (typeof settings.minRewardRisk === "number" &&
        Number.isFinite(settings.minRewardRisk) &&
        settings.minRewardRisk > 0 &&
        settings.minRewardRisk <= MAX_DASHBOARD_REWARD_RISK))
  );
}

export function applyDashboardSettings(
  config: AppConfig,
  settings: DashboardSettings | null
): AppConfig {
  if (!settings) {
    return config;
  }
  return {
    ...config,
    symbols: [...settings.symbols],
    interval: settings.interval,
    scanIntervalMs: settings.scanIntervalMs,
    ...(settings.minRewardRisk === undefined
      ? {}
      : { minRewardRisk: settings.minRewardRisk }),
  };
}
