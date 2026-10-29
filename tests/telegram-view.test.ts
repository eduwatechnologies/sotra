import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config";
import {
  formatMarkets,
  formatMorningReport,
  formatScanResults,
  formatSignal,
  formatStatus,
  formatWelcome,
} from "../src/views/telegram-view";

const config: AppConfig = {
  telegramBotToken: "token",
  telegramChatId: "123",
  twelveDataApiKey: "key",
  symbols: ["EUR/USD", "XAU/USD"],
  interval: "5min",
  scanIntervalMs: 1_800_000,
  minRewardRisk: 2,
  swingLookback: 10,
  structureLookback: 5,
  maxBarsSinceSweep: 3,
  atrPeriod: 14,
  maxRiskAtrMultiple: 2,
  maxCandleAgeMinutes: 20,
  maxStoredSignalKeys: 1000,
  stateFile: "state.json",
  stateBackend: "file",
};

test("formats status, watchlist, and welcome screens from application data", () => {
  assert.match(formatStatus(config, true), /Alerts: paused/);
  assert.match(formatStatus(config, false), /EUR\/USD, XAU\/USD/);
  assert.match(formatStatus({ ...config, stateBackend: "upstash" }, false), /cron-job\.org/);
  assert.match(formatStatus({ ...config, stateBackend: "upstash" }, false), /signals every 30 minute\(s\)/);
  assert.equal(formatMarkets(config.symbols), "Configured markets:\n• EUR/USD\n• XAU/USD");
  assert.match(formatWelcome(), /\/scan — scan now/);
});

test("formats manual scan delivery state and paused notice", () => {
  const message = formatScanResults(
    [
      {
        symbol: "EUR/USD",
        status: "signal",
        sent: false,
        signal: {
          symbol: "EUR/USD",
          direction: "BUY",
          entry: 1.1,
          stopLoss: 1.09,
          takeProfit: 1.12,
          rewardRisk: 2,
          timestamp: Date.UTC(2026, 0, 1),
          rationale: "Sweep and structure confirmation.",
        },
      },
      { symbol: "XAU/USD", status: "error", error: "secret detail" },
    ],
    true
  );
  assert.match(message, /EUR\/USD: BUY signal/);
  assert.match(message, /not sent; alert delivery was disabled or paused/);
  assert.match(message, /XAU\/USD: scan failed/);
  assert.match(message, /manual scans do not send signal alerts/);
  assert.doesNotMatch(message, /secret detail/);
});

test("formats signal alerts with levels and a UTC timestamp", () => {
  const message = formatSignal({
    symbol: "EUR/USD",
    direction: "BUY",
    entry: 1.1,
    stopLoss: 1.09,
    takeProfit: 1.12,
    rewardRisk: 2,
    timestamp: Date.UTC(2026, 0, 1),
    rationale: "Sweep and structure confirmation.",
  });
  assert.match(message, /✨ SOTRA SIGNALS/);
  assert.match(message, /🟢 EUR\/USD\s+\|\s+BUY ↗️/);
  assert.match(message, /🎯 Entry/);
  assert.match(message, /🛑 Stop loss/);
  assert.match(message, /🏁 Take profit/);
  assert.match(message, /⚖️ Planned R:R/);
  assert.match(message, /Entry\s+1\.10000/);
  assert.match(message, /1\.09000/);
  assert.match(message, /1\.12000/);
  assert.match(message, /2026-01-01T00:00:00\.000Z/);
});

test("formats the daily Lagos multi-timeframe report", () => {
  const message = formatMorningReport(
    [
      {
        symbol: "EUR/USD",
        bias: "bullish",
        biasExplanation: "Recent 4H swings show higher highs and higher lows.",
        trendline: "aligned",
        marketStructureShift: "confirmed",
        orderBlock: { low: 1.08, high: 1.09 },
        entrySignal: {
          symbol: "EUR/USD",
          direction: "BUY",
          entry: 1.1,
          stopLoss: 1.09,
          takeProfit: 1.12,
          rewardRisk: 2,
          timestamp: Date.UTC(2026, 9, 28, 8),
          rationale: "Liquidity sweep and structure confirmation.",
        },
        entryExplanation: "5-minute setup aligned.",
        staleTimeframes: [],
      },
    ],
    Date.UTC(2026, 9, 28, 8)
  );
  assert.match(message, /MORNING MARKET REPORT/);
  assert.match(message, /Africa\/Lagos/);
  assert.match(message, /4H BULLISH/);
  assert.match(message, /1H trendline: aligned; MSS: confirmed/);
  assert.match(message, /1H order-block approximation/);
  assert.match(message, /5M entry: BUY/);
  assert.match(message, /Analysis only/);
});

test("uses a red downward indicator for sell signals", () => {
  const message = formatSignal({
    symbol: "XAU/USD",
    direction: "SELL",
    entry: 2350,
    stopLoss: 2360,
    takeProfit: 2330,
    rewardRisk: 2,
    timestamp: Date.UTC(2026, 0, 1),
    rationale: "Liquidity sweep and bearish structure shift.",
  });
  assert.match(message, /🔴 XAU\/USD\s+\|\s+SELL ↘️/);
  assert.match(message, /Stop loss\s+2360\.00/);
});
