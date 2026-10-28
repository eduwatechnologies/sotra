import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config";
import { SignalScanner } from "../src/services/scanner";
import { StateStore } from "../src/models/state";
import type { Candle } from "../src/models/domain";

const config: AppConfig = {
  telegramBotToken: "test-token",
  telegramChatId: "123",
  twelveDataApiKey: "test-key",
  symbols: ["EUR/USD"],
  interval: "5min",
  scanIntervalMs: 300_000,
  minRewardRisk: 2,
  swingLookback: 3,
  structureLookback: 2,
  maxCandleAgeMinutes: 20,
  maxStoredSignalKeys: 10,
  stateFile: "",
  stateBackend: "file",
};

function fixture(): Candle[] {
  const start = Date.UTC(2026, 0, 1);
  const candles: Candle[] = Array.from({ length: 5 }, (_, index) => ({
    timestamp: start + index * 300_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
  candles.push(
    { timestamp: start + 5 * 300_000, open: 100, high: 100.5, low: 98, close: 99.5 },
    { timestamp: start + 6 * 300_000, open: 99.5, high: 102, low: 99.5, close: 102 },
    { timestamp: start + 7 * 300_000, open: 100, high: 103, low: 97, close: 100 }
  );
  return candles;
}

async function createState(directory: string): Promise<StateStore> {
  const state = new StateStore(path.join(directory, "state.json"), config.maxStoredSignalKeys);
  await state.load();
  return state;
}

test("deduplicates delivered signals after a process restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-scanner-"));
  try {
    let deliveryCount = 0;
    const now = fixture()[6].timestamp + 5 * 60_000;
    const firstState = await createState(directory);
    const first = new SignalScanner(config, firstState, {
      fetchCandles: async () => fixture(),
      publish: async () => {
        deliveryCount += 1;
      },
      logError: () => assert.fail("Unexpected scan error"),
      now: () => now,
    });
    const firstResult = await first.scan({ publishAlerts: true, scheduled: true });

    const restartedState = await createState(directory);
    const restarted = new SignalScanner(config, restartedState, {
      fetchCandles: async () => fixture(),
      publish: async () => {
        deliveryCount += 1;
      },
      logError: () => assert.fail("Unexpected scan error"),
      now: () => now,
    });
    const restartedResult = await restarted.scan({ publishAlerts: true, scheduled: true });

    assert.equal(firstResult[0].status, "signal");
    assert.equal(firstResult[0].sent, true);
    assert.equal(restartedResult[0].status, "duplicate");
    assert.equal(deliveryCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("manual scans analyze while paused but do not deliver alerts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-scanner-"));
  try {
    const state = await createState(directory);
    await state.setPaused(true);
    let deliveryCount = 0;
    const now = fixture()[6].timestamp + 5 * 60_000;
    const scanner = new SignalScanner(config, state, {
      fetchCandles: async () => fixture(),
      publish: async () => {
        deliveryCount += 1;
      },
      logError: () => assert.fail("Unexpected scan error"),
      now: () => now,
    });

    const result = await scanner.scan({ publishAlerts: false, scheduled: false });
    assert.equal(result[0].status, "signal");
    assert.equal(result[0].sent, false);
    assert.equal((await state.get()).paused, true);
    assert.equal(deliveryCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects overlapping scans", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-scanner-"));
  try {
    const state = await createState(directory);
    let startFetch!: () => void;
    let finishFetch!: (candles: Candle[]) => void;
    const fetching = new Promise<Candle[]>((resolve) => {
      finishFetch = resolve;
    });

    test("releases a failed alert claim so a later scan can retry delivery", async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-scanner-"));
      try {
        const state = await createState(directory);
        let deliveryCount = 0;
        const now = fixture()[6].timestamp + 5 * 60_000;
        const scanner = new SignalScanner(config, state, {
          fetchCandles: async () => fixture(),
          publish: async () => {
            deliveryCount += 1;
            if (deliveryCount === 1) {
              throw new Error("Telegram is temporarily unavailable");
            }
          },
          logError: () => undefined,
          now: () => now,
        });

        const failed = await scanner.scan({ publishAlerts: true, scheduled: true });
        const retried = await scanner.scan({ publishAlerts: true, scheduled: true });
        assert.equal(failed[0].status, "error");
        assert.equal(retried[0].status, "signal");
        assert.equal(retried[0].sent, true);
        assert.equal(deliveryCount, 2);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
    const started = new Promise<void>((resolve) => {
      startFetch = resolve;
    });
    const scanner = new SignalScanner(config, state, {
      fetchCandles: async () => {
        startFetch();
        return fetching;
      },
      publish: async () => undefined,
      logError: () => assert.fail("Unexpected scan error"),
    });
    const activeScan = scanner.scan({ publishAlerts: false, scheduled: false });
    await started;
    await assert.rejects(
      scanner.scan({ publishAlerts: false, scheduled: false }),
      /already running/
    );
    const secondScanner = new SignalScanner(config, state, {
      fetchCandles: async () => [],
      publish: async () => undefined,
      logError: () => assert.fail("Unexpected scan error"),
    });
    await assert.rejects(
      secondScanner.scan({ publishAlerts: false, scheduled: false }),
      /already running/
    );
    finishFetch([]);
    await activeScan;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
