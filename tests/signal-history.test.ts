import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSignalOutcome,
  strategyPerformance,
  type TrackedSignal,
} from "../src/models/signal-history";

const start = Date.UTC(2026, 0, 1);
const record: TrackedSignal = {
  id: "signal-id",
  key: "signal-key",
  signal: {
    symbol: "EUR/USD",
    direction: "BUY",
    entry: 1.1,
    stopLoss: 1.09,
    takeProfit: 1.12,
    rewardRisk: 2,
    timestamp: start,
    rationale: "Liquidity sweep and structure shift.",
  },
  strategy: {
    id: "default",
    name: "Default strategy",
    parameters: {
      minRewardRisk: 2,
      swingLookback: 3,
      structureLookback: 2,
      maxBarsSinceSweep: 3,
      atrPeriod: 3,
      maxRiskAtrMultiple: 2,
      maxCandleAgeMinutes: 20,
    },
  },
  detectedAt: start,
  candleInterval: "5min",
  deliveryStatus: "not_attempted",
  outcome: "unresolved",
  outcomeAt: null,
};

function candle(timestamp: number, high: number, low: number) {
  return { timestamp, open: 1.1, high, low, close: 1.1 };
}

test("evaluates only complete candles that start strictly after detection", () => {
  const result = evaluateSignalOutcome(
    record,
    [
      candle(start, 1.13, 1.08),
      candle(start + 300_000, 1.11, 1.095),
      candle(start + 600_000, 1.125, 1.095),
    ],
    start + 900_000
  );
  assert.deepEqual(result, { outcome: "win", at: start + 600_000 });
});

test("the first stop loss touch wins over a later take profit touch", () => {
  const result = evaluateSignalOutcome(
    record,
    [
      candle(start + 300_000, 1.11, 1.08),
      candle(start + 600_000, 1.13, 1.095),
    ],
    start + 900_000
  );
  assert.deepEqual(result, { outcome: "loss", at: start + 300_000 });
});

test("marks a candle touching both levels ambiguous instead of guessing", () => {
  const result = evaluateSignalOutcome(
    record,
    [candle(start + 300_000, 1.13, 1.08)],
    start + 600_000
  );
  assert.deepEqual(result, { outcome: "ambiguous", at: start + 300_000 });
});

test("evaluates take profit and stop loss in the sell direction", () => {
  const sellRecord: TrackedSignal = {
    ...record,
    signal: { ...record.signal, direction: "SELL", stopLoss: 1.11, takeProfit: 1.08 },
  };
  const result = evaluateSignalOutcome(
    sellRecord,
    [
      candle(start + 300_000, 1.105, 1.095),
      candle(start + 600_000, 1.109, 1.075),
    ],
    start + 900_000
  );
  assert.deepEqual(result, { outcome: "win", at: start + 600_000 });
});

test("leaves unresolved signals unchanged when there are no complete post-detection candles", () => {
  assert.equal(
    evaluateSignalOutcome(
      record,
      [candle(start + 300_000, 1.13, 1.08)],
      start + 400_000
    ),
    null
  );
  assert.equal(evaluateSignalOutcome(record, [], start + 900_000), null);
});

test("calculates strategy win rate from resolved results only", () => {
  const strategySignals: TrackedSignal[] = [
    { ...record, outcome: "win" },
    { ...record, id: "loss", key: "loss", outcome: "loss" },
    { ...record, id: "pending", key: "pending", outcome: "unresolved" },
    { ...record, id: "ambiguous", key: "ambiguous", outcome: "ambiguous" },
  ];
  assert.deepEqual(strategyPerformance(strategySignals), [
    {
      strategyId: "default",
      strategyName: "Default strategy",
      total: 4,
      wins: 1,
      losses: 1,
      unresolved: 2,
      winRate: 50,
    },
  ]);
});

test("uses a null win rate when a strategy has no resolved signals", () => {
  const result = strategyPerformance([record]);
  assert.equal(result[0].winRate, null);
});
