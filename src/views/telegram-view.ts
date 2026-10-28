import type { AppConfig } from "../config";
import type { ScanResult } from "../services/scanner";
import type { Signal } from "../models/domain";

function formatPrice(value: number, symbol: string): string {
  return value.toFixed(symbol.toUpperCase().includes("XAU") ? 2 : 5);
}

export function formatSignal(signal: Signal): string {
  return (
    `Sotra Signals\n` +
    `${signal.symbol} — ${signal.direction}\n` +
    `Entry: ${formatPrice(signal.entry, signal.symbol)}\n` +
    `Stop loss: ${formatPrice(signal.stopLoss, signal.symbol)}\n` +
    `Take profit: ${formatPrice(signal.takeProfit, signal.symbol)}\n` +
    `Planned R:R: ${signal.rewardRisk.toFixed(2)}:1\n` +
    `Setup: ${signal.rationale}\n` +
    `Signal candle (UTC): ${new Date(signal.timestamp).toISOString()}\n\n` +
    "Verify broker price, spread, and risk before acting. This is not financial advice."
  );
}

export function formatScanResults(results: ScanResult[], paused: boolean): string {
  const lines = results.map((result) => {
    if (result.status === "signal" && result.signal) {
      const delivery = result.sent
        ? " (alert sent)"
        : " (not sent; alert delivery was disabled or paused)";
      return `${result.symbol}: ${result.signal.direction} signal${delivery}`;
    }
    if (result.status === "error") {
      return `${result.symbol}: scan failed`;
    }
    return `${result.symbol}: ${result.status}`;
  });
  return `Scan results:\n${lines.join("\n")}${
    paused ? "\nAlerts are paused; manual scans do not send signal alerts." : ""
  }`;
}

export function formatWelcome(): string {
  return (
    "Welcome to Sotra Signals. This private bot scans configured markets for rule-based setups; it does not place trades.\n\n" +
    "Commands:\n" +
    "/status — bot configuration and alert state\n" +
    "/markets — configured symbols\n" +
    "/scan — scan now\n" +
    "/last — latest detected signal\n" +
    "/pause — pause scheduled alerts\n" +
    "/resume — resume scheduled alerts"
  );
}

export function formatStatus(
  config: AppConfig,
  paused: boolean
): string {
  return (
    `Sotra Signals is online.\n` +
    `Alerts: ${paused ? "paused" : "active"}\n` +
    `Markets: ${config.symbols.join(", ")}\n` +
    `Interval: ${config.interval}\n` +
    `Scan frequency: ${Math.round(config.scanIntervalMs / 60_000)} minute(s)\n` +
    `Minimum planned R:R: ${config.minRewardRisk}:1`
  );
}

export function formatMarkets(symbols: string[]): string {
  return `Configured markets:\n${symbols.map((symbol) => `• ${symbol}`).join("\n")}`;
}
