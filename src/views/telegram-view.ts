import type { AppConfig } from "../config";
import type { ScanResult } from "../services/scanner";
import type { MorningReportEntry } from "../services/morning-report";
import type { Signal } from "../models/domain";
import { MORNING_REPORT_TIMEZONE } from "../services/morning-report";

function formatPrice(value: number, symbol: string): string {
  return value.toFixed(symbol.toUpperCase().includes("XAU") ? 2 : 5);
}

export function formatSignal(signal: Signal): string {
  const isBuy = signal.direction === "BUY";
  const directionIcon = isBuy ? "🟢" : "🔴";
  const directionArrow = isBuy ? "↗️" : "↘️";

  return (
    `✨ SOTRA SIGNALS\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${directionIcon} ${signal.symbol}  |  ${signal.direction} ${directionArrow}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🎯 Entry       ${formatPrice(signal.entry, signal.symbol)}\n` +
    `🛑 Stop loss   ${formatPrice(signal.stopLoss, signal.symbol)}\n` +
    `🏁 Take profit ${formatPrice(signal.takeProfit, signal.symbol)}\n` +
    `⚖️ Planned R:R ${signal.rewardRisk.toFixed(2)}:1\n\n` +
    `🔎 SETUP\n${signal.rationale}\n\n` +
    `🕒 ${new Date(signal.timestamp).toISOString()} UTC\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    "⚠️ Verify broker price, spread, and risk before acting. Not financial advice."
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
    `Scan schedule: ${
      config.stateBackend === "upstash"
        ? `signals every ${Math.round(config.scanIntervalMs / 60_000)} minute(s) via cron-job.org; morning report daily at 09:00 Africa/Lagos`
        : `${Math.round(config.scanIntervalMs / 60_000)} minute(s)`
    }\n` +
    `Minimum planned R:R: ${config.minRewardRisk}:1`
  );
}

export function formatMorningReport(
  entries: MorningReportEntry[],
  generatedAt = Date.now()
): string {
  const timestamp = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: MORNING_REPORT_TIMEZONE,
  }).format(generatedAt);
  const sections = entries.map((entry) => {
    if (entry.error) {
      return `⚠️ ${entry.symbol}\nMarket data unavailable: ${entry.error}`;
    }

    const biasIcon = entry.bias === "bullish" ? "🟢" : entry.bias === "bearish" ? "🔴" : "⚪";
    const lines = [
      `${biasIcon} ${entry.symbol} — 4H ${entry.bias.toUpperCase()}`,
      `📈 4H bias: ${entry.biasExplanation}`,
      `🧭 1H trendline: ${entry.trendline}; MSS: ${entry.marketStructureShift}`,
      entry.orderBlock
        ? `🧱 1H order-block approximation: ${formatPrice(entry.orderBlock.low, entry.symbol)}–${formatPrice(entry.orderBlock.high, entry.symbol)}`
        : "🧱 1H order-block approximation: not identified",
    ];
    if (entry.entrySignal) {
      const signal = entry.entrySignal;
      lines.push(
        `🎯 5M entry: ${signal.direction} @ ${formatPrice(signal.entry, entry.symbol)}`,
        `🛑 Stop: ${formatPrice(signal.stopLoss, entry.symbol)}  |  🏁 Target: ${formatPrice(signal.takeProfit, entry.symbol)}  |  R:R ${signal.rewardRisk.toFixed(2)}:1`
      );
    } else {
      lines.push(`⏳ 5M entry: ${entry.entryExplanation}`);
    }
    if (entry.staleTimeframes.length > 0) {
      lines.push(`⚠️ Stale data: ${entry.staleTimeframes.join(", ")}`);
    }
    return lines.join("\n");
  });

  return (
    `☀️ SOTRA SIGNALS — MORNING MARKET REPORT\n` +
    `🕒 ${timestamp} (${MORNING_REPORT_TIMEZONE})\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${sections.join("\n\n")}\n\n` +
    "Rules are mechanical approximations: 4H swing bias, 1H swing trendline/MSS and last-opposing-candle zone, then 5M liquidity-sweep confirmation. Analysis only; verify market conditions and risk independently."
  );
}

export function formatMarkets(symbols: string[]): string {
  return `Configured markets:\n${symbols.map((symbol) => `• ${symbol}`).join("\n")}`;
}
