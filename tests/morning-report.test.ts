import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config";
import type { Candle } from "../src/models/domain";
import {
  analyzeMorningSetup,
  generateMorningReport,
  MORNING_REPORT_TIMEFRAMES,
} from "../src/services/morning-report";

const config: AppConfig = {
  telegramBotToken: "token",
  telegramChatId: "123",
  twelveDataApiKey: "key",
  symbols: ["EUR/USD"],
  interval: "5min",
  scanIntervalMs: 300_000,
  minRewardRisk: 2,
  swingLookback: 3,
  structureLookback: 2,
  maxCandleAgeMinutes: 20,
  maxStoredSignalKeys: 1000,
  stateFile: "state.json",
  stateBackend: "upstash",
};

const now = Date.UTC(2026, 9, 28, 8);

function candlesFromCloses(
  closes: number[],
  intervalMs: number,
  endTime = now
): Candle[] {
  return closes.map((close, index) => {
    const previous = closes[index - 1] ?? close;
    const open = close === previous ? close : close > previous ? close - 0.3 : close + 0.3;
    return {
      timestamp: endTime - (closes.length - index) * intervalMs,
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
    };
  });
}

function bullishSetup(): Record<keyof typeof MORNING_REPORT_TIMEFRAMES, Candle[]> {
  const fourHour = candlesFromCloses(
    [100, 102, 105, 103, 101, 103, 107, 105, 103, 105, 109, 107, 105],
    4 * 60 * 60_000
  );
  const oneHour = candlesFromCloses(
    [20, 21, 22, 21, 20, 22, 24, 23, 22, 25, 26],
    60 * 60_000
  );
  const fiveMinute = [
    ...Array.from({ length: 5 }, (_, index): Candle => ({
      timestamp: now - (8 - index) * 5 * 60_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
    })),
    {
      timestamp: now - 2 * 5 * 60_000,
      open: 100,
      high: 100.5,
      low: 98,
      close: 99.5,
    },
    {
      timestamp: now - 5 * 60_000,
      open: 99.5,
      high: 102,
      low: 99.5,
      close: 102,
    },
  ];
  return { bias: fourHour, setup: oneHour, entry: fiveMinute };
}

test("identifies aligned 4H bias, 1H setup, order-block approximation, and 5M entry", () => {
  const result = analyzeMorningSetup("EUR/USD", bullishSetup(), config, now);
  assert.equal(result.bias, "bullish");
  assert.equal(result.trendline, "aligned", JSON.stringify(result));
  assert.equal(result.marketStructureShift, "confirmed");
  assert.ok(result.orderBlock);
  assert.equal(result.entrySignal?.direction, "BUY");
  assert.deepEqual(result.staleTimeframes, []);
});

test("excludes an incomplete 4H candle from the current bias", () => {
  const setup = bullishSetup();
  const incompleteFourHour = {
    ...setup.bias[setup.bias.length - 1],
    timestamp: now - 60 * 60_000,
    close: 999,
    high: 1000,
  };
  const result = analyzeMorningSetup(
    "EUR/USD",
    { ...setup, bias: [...setup.bias, incompleteFourHour] },
    config,
    now
  );
  assert.equal(result.bias, "bullish");
});

test("withholds bias and entry when the latest completed 4H data is stale", () => {
  const setup = bullishSetup();
  const staleBias = setup.bias.map((candle) => ({
    ...candle,
    timestamp: candle.timestamp - 24 * 60 * 60_000,
  }));
  const result = analyzeMorningSetup(
    "EUR/USD",
    { ...setup, bias: staleBias },
    config,
    now
  );
  assert.equal(result.bias, "neutral");
  assert.ok(result.staleTimeframes.includes("4H"));
  assert.equal(result.entrySignal, null);
});

test("generates each configured symbol report and isolates provider failures", async () => {
  const intervals: string[] = [];
  const results = await generateMorningReport(
    { ...config, symbols: ["EUR/USD", "XAU/USD"] },
    {
      now: () => now,
      fetchCandles: async (symbol, interval) => {
        intervals.push(`${symbol}:${interval}`);
        if (symbol === "XAU/USD") {
          throw new Error("provider unavailable");
        }
        const setup = bullishSetup();
        return interval === "4h" ? setup.bias : interval === "1h" ? setup.setup : setup.entry;
      },
    }
  );
  assert.deepEqual(intervals, [
    "EUR/USD:4h",
    "EUR/USD:1h",
    "EUR/USD:5min",
    "XAU/USD:4h",
    "XAU/USD:1h",
    "XAU/USD:5min",
  ]);
  assert.equal(results[0].entrySignal?.direction, "BUY");
  assert.match(results[1].error ?? "", /provider unavailable/);
});
