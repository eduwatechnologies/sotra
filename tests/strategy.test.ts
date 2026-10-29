import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCandles, type StrategyConfig } from "../src/services/strategy";
import type { Candle } from "../src/models/domain";

const config: StrategyConfig = {
  swingLookback: 3,
  structureLookback: 2,
  minRewardRisk: 3,
  maxBarsSinceSweep: 3,
  atrPeriod: 3,
  maxRiskAtrMultiple: 2,
  maxCandleAgeMinutes: 20,
};

function fixture(direction: "BUY" | "SELL"): Candle[] {
  const start = Date.UTC(2026, 0, 1);
  const candles: Candle[] = Array.from({ length: 5 }, (_, index) => ({
    timestamp: start + index * 300_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
  candles.push(
    direction === "BUY"
      ? { timestamp: start + 5 * 300_000, open: 100, high: 100.5, low: 98, close: 99.5 }
      : { timestamp: start + 5 * 300_000, open: 100, high: 102, low: 99.5, close: 100.5 },
    direction === "BUY"
      ? { timestamp: start + 6 * 300_000, open: 99.5, high: 102, low: 99.5, close: 102 }
      : { timestamp: start + 6 * 300_000, open: 100.5, high: 100.5, low: 98, close: 98 },
    { timestamp: start + 7 * 300_000, open: 100, high: 103, low: 97, close: 100 }
  );
  return candles;
}

test("returns no signal for insufficient, stale, and monotonic candle history", () => {
  const candles = fixture("BUY");
  const now = candles[6].timestamp + 5 * 60_000;
  assert.equal(analyzeCandles(candles.slice(0, 4), "EUR/USD", config, now), null);
  assert.equal(analyzeCandles(candles, "EUR/USD", config, now + 21 * 60_000), null);

  const monotonic = candles.map((candle, index) => ({
    ...candle,
    open: 100 + index * 0.1,
    high: 101 + index * 0.1,
    low: 99 + index * 0.1,
    close: 100 + index * 0.1,
  }));
  assert.equal(analyzeCandles(monotonic, "EUR/USD", config, now), null);
});

test("detects correctly placed bullish and bearish signals", () => {
  const bullishCandles = fixture("BUY");
  const now = bullishCandles[6].timestamp + 5 * 60_000;
  const bullish = analyzeCandles(bullishCandles, "EUR/USD", config, now);
  assert.equal(bullish?.direction, "BUY");
  assert.equal(bullish?.entry, 102);
  assert.equal(bullish?.stopLoss, 98);
  assert.equal(bullish?.takeProfit, 114);
  assert.equal(bullish?.rewardRisk, 3);

  const bearishCandles = fixture("SELL");
  const bearish = analyzeCandles(bearishCandles, "EUR/USD", config, now);
  assert.equal(bearish?.direction, "SELL");
  assert.equal(bearish?.entry, 98);
  assert.equal(bearish?.stopLoss, 102);
  assert.equal(bearish?.takeProfit, 86);
});

test("requires structure confirmation on the latest completed candle and is order independent", () => {
  const candles = fixture("BUY");
  const now = candles[6].timestamp + 5 * 60_000;
  candles[6] = { ...candles[6], close: 100.5 };
  assert.equal(analyzeCandles(candles, "EUR/USD", config, now), null);

  const valid = fixture("BUY");
  const reordered = analyzeCandles([...valid].reverse(), "EUR/USD", config, now);
  assert.equal(reordered?.direction, "BUY");
});

test("excludes the newest potentially forming candle", () => {
  const candles = fixture("BUY");
  candles[6] = { ...candles[6], close: 100.5 };
  candles[7] = { ...candles[7], close: 103 };
  const now = candles[7].timestamp + 60_000;
  assert.equal(analyzeCandles(candles, "EUR/USD", config, now), null);
});

test("rejects malformed candles and invalid strategy parameters", () => {
  const candles = fixture("BUY");
  candles[0] = { ...candles[0], low: 101 };
  assert.equal(analyzeCandles(candles, "EUR/USD", config), null);
  assert.throws(() => analyzeCandles([], "EUR/USD", { ...config, minRewardRisk: 0 }), /Invalid strategy configuration/);
});
