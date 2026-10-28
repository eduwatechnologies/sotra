import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config";
import {
  formatMarkets,
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
  scanIntervalMs: 300_000,
  minRewardRisk: 2,
  swingLookback: 10,
  structureLookback: 5,
  maxCandleAgeMinutes: 20,
  maxStoredSignalKeys: 1000,
  stateFile: "state.json",
};

test("formats status, watchlist, and welcome screens from application data", () => {
  assert.match(formatStatus(config, true), /Alerts: paused/);
  assert.match(formatStatus(config, false), /EUR\/USD, XAU\/USD/);
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
  assert.match(message, /Entry: 1\.10000/);
  assert.match(message, /Stop loss: 1\.09000/);
  assert.match(message, /Take profit: 1\.12000/);
  assert.match(message, /2026-01-01T00:00:00\.000Z/);
});
