import assert from "node:assert/strict";
import test from "node:test";
import { parseTwelveDataResponse } from "../src/services/market-data";

test("validates and sorts provider candles chronologically", () => {
  const candles = parseTwelveDataResponse({
    values: [
      { datetime: "2026-01-01 00:05:00", open: "2", high: "3", low: "1", close: "2.5" },
      { datetime: "2026-01-01 00:00:00", open: "1.5", high: "2", low: "1", close: "1.8" },
    ],
  });
  assert.equal(candles.length, 2);
  assert.ok(candles[0].timestamp < candles[1].timestamp);
});

test("rejects inconsistent or malformed OHLC values", () => {
  assert.throws(
    () =>
      parseTwelveDataResponse({
        values: [{ datetime: "2026-01-01 00:00:00", open: 1, high: 0.9, low: 0.8, close: 1 }],
      }),
    /inconsistent OHLC/
  );
  assert.throws(() => parseTwelveDataResponse({ values: [] }), /no candle values/);
});

test("reports provider quota and symbol errors without accepting data", () => {
  assert.throws(
    () => parseTwelveDataResponse({ status: "error", message: "Invalid API call" }),
    /Invalid API call/
  );
});
