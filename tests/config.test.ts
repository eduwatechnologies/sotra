import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config";

const required = {
  TELEGRAM_BOT_TOKEN: "bot-token",
  TELEGRAM_CHAT_ID: "123456",
  TWELVE_DATA_API_KEY: "data-key",
};

test("loads documented defaults and trims configured symbols", () => {
  const config = loadConfig({ ...required, SYMBOLS: " EUR/USD,GBP/USD,EUR/USD " });
  assert.deepEqual(config.symbols, ["EUR/USD", "GBP/USD"]);
  assert.equal(config.interval, "5min");
  assert.equal(config.scanIntervalMs, 1_800_000);
  assert.equal(config.minRewardRisk, 3);
  assert.equal(config.swingLookback, 10);
  assert.equal(config.structureLookback, 5);
  assert.equal(config.maxBarsSinceSweep, 3);
  assert.equal(config.atrPeriod, 14);
  assert.equal(config.maxRiskAtrMultiple, 2);
  assert.equal(config.maxCandleAgeMinutes, 20);
  assert.equal(config.stateBackend, "file");
});

test("selects Upstash as the Vercel state backend by default", () => {
  const config = loadConfig({ ...required, VERCEL: "1" });
  assert.equal(config.stateBackend, "upstash");
  assert.throws(
    () => loadConfig({ ...required, VERCEL: "1", STATE_BACKEND: "file" }),
    /Vercel deployments require STATE_BACKEND=upstash/
  );
});

test("fails clearly when required credentials are missing", () => {
  assert.throws(() => loadConfig({}), /TELEGRAM_CHAT_ID/);
});

test("rejects malformed configuration values", () => {
  assert.throws(
    () => loadConfig({ ...required, SCAN_INTERVAL_MS: "0" }),
    /SCAN_INTERVAL_MS must be a positive integer/
  );
  assert.throws(
    () => loadConfig({ ...required, MAX_BARS_SINCE_SWEEP: "1.5" }),
    /MAX_BARS_SINCE_SWEEP must be a positive integer/
  );
  assert.throws(
    () => loadConfig({ ...required, ATR_PERIOD: "0" }),
    /ATR_PERIOD must be a positive integer/
  );
  assert.throws(
    () => loadConfig({ ...required, MAX_RISK_ATR_MULTIPLE: "0" }),
    /MAX_RISK_ATR_MULTIPLE must be a positive number/
  );
  assert.equal(loadConfig({ ...required, SCAN_INTERVAL_MS: "3600000" }).scanIntervalMs, 3_600_000);
  assert.throws(() => loadConfig({ ...required, TELEGRAM_CHAT_ID: "owner" }), /numeric Telegram chat ID/);
});
