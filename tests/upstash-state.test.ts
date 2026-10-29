import assert from "node:assert/strict";
import test from "node:test";
import { parseLatestSignal } from "../src/models/upstash-state";
import type { Signal } from "../src/models/domain";

const signal: Signal = {
  symbol: "EUR/USD",
  direction: "BUY",
  entry: 1.1,
  stopLoss: 1.09,
  takeProfit: 1.12,
  rewardRisk: 2,
  timestamp: Date.UTC(2026, 0, 1),
  rationale: "Liquidity sweep and structure shift.",
};

test("accepts a latest signal already decoded by Upstash Redis", () => {
  assert.deepEqual(parseLatestSignal(signal), signal);
});

test("accepts a latest signal stored as JSON text", () => {
  assert.deepEqual(parseLatestSignal(JSON.stringify(signal)), signal);
});

test("rejects malformed stored latest signals", () => {
  assert.throws(() => parseLatestSignal("[object Object]"), /JSON/);
  assert.throws(() => parseLatestSignal({ symbol: "EUR/USD" }), /malformed/);
});
