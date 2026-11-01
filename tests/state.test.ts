import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { signalKey, StateStore } from "../src/models/state";
import type { Signal } from "../src/models/domain";
import type { TrackedSignal } from "../src/models/signal-history";

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
const trackedSignal: TrackedSignal = {
  id: "history-id",
  key: signalKey(signal),
  signal,
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
  detectedAt: signal.timestamp + 1,
  candleInterval: "5min",
  deliveryStatus: "failed",
  outcome: "unresolved",
  outcomeAt: null,
};

test("persists pause state, latest signal, and bounded deduplication keys", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-state-"));
  const file = path.join(directory, "state.json");
  try {
    const state = new StateStore(file, 2);
    await state.load();
    await state.setPaused(true);
    await state.setDashboardSettings({
      symbols: ["EUR/USD"],
      interval: "15min",
      scanIntervalMs: 600_000,
      minRewardRisk: 2.5,
    });
    await state.setStrategyProfiles(
      [
        {
          id: "conservative",
          name: "Conservative",
          minRewardRisk: 3,
          swingLookback: 12,
          structureLookback: 6,
          maxBarsSinceSweep: 2,
          atrPeriod: 14,
          maxRiskAtrMultiple: 1.5,
          maxCandleAgeMinutes: 15,
        },
      ],
      "conservative"
    );
    await state.recordLatestSignal(signal);
    await state.recordDetectedSignal(trackedSignal);
    await state.recordSentSignal(signalKey(signal));
    await state.recordSentSignal("second");
    await state.recordSentSignal("third");

    const restarted = new StateStore(file, 2);
    const loaded = await restarted.load();
    assert.equal(loaded.paused, true);
    assert.deepEqual(loaded.dashboardSettings, {
      symbols: ["EUR/USD"],
      interval: "15min",
      scanIntervalMs: 600_000,
      minRewardRisk: 2.5,
    });
    assert.equal(loaded.activeStrategyProfileId, "conservative");
    assert.equal(loaded.strategyProfiles[0].name, "Conservative");
    assert.deepEqual(loaded.latestSignal, signal);
    assert.deepEqual(loaded.signalHistory, [trackedSignal]);
    assert.equal(loaded.sentSignalKeys.length, 2);
    assert.equal(await restarted.hasSent(signalKey(signal)), false);
    assert.equal(JSON.parse(await readFile(file, "utf8")).paused, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("validates strategy profiles before persisting them", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-state-"));
  try {
    const state = new StateStore(path.join(directory, "state.json"), 10);
    await state.load();
    await assert.rejects(
      state.setStrategyProfiles(
        [
          {
            id: "invalid",
            name: "Invalid",
            minRewardRisk: 3,
            swingLookback: 10,
            structureLookback: 5,
            maxBarsSinceSweep: 3,
            atrPeriod: 14,
            maxRiskAtrMultiple: 2,
            maxCandleAgeMinutes: 20,
          },
        ],
        "missing"
      ),
      /invalid/
    );
    assert.deepEqual((await state.get()).strategyProfiles, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("serializes concurrent state updates without losing changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-state-"));
  const file = path.join(directory, "state.json");
  try {
    const state = new StateStore(file, 10);
    await state.load();
    await Promise.all([
      state.setPaused(true),
      state.recordLatestSignal(signal),
      state.recordSentSignal(signalKey(signal)),
    ]);

    const restarted = new StateStore(file, 10);
    const loaded = await restarted.load();
    assert.equal(loaded.paused, true);
    assert.deepEqual(loaded.latestSignal, signal);
    assert.equal(await restarted.hasSent(signalKey(signal)), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("claims alerts and scan locks only once at a time", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-state-"));
  try {
    const state = new StateStore(path.join(directory, "state.json"), 10);
    await state.load();
    const claimResults = await Promise.all([
      state.claimSignal(signalKey(signal)),
      state.claimSignal(signalKey(signal)),
    ]);
    assert.equal(claimResults.filter(Boolean).length, 1);
    assert.equal(await state.acquireScanLock(), true);
    assert.equal(await state.acquireScanLock(), false);
    await state.releaseSignal(signalKey(signal));
    await state.releaseScanLock();
    assert.equal(await state.claimSignal(signalKey(signal)), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails explicitly for malformed persisted state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-state-"));
  const file = path.join(directory, "state.json");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "{broken");
    await assert.rejects(new StateStore(file, 10).load());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loads state files created before dashboard settings were added", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-state-"));
  const file = path.join(directory, "state.json");
  try {
    await writeFile(
      file,
      JSON.stringify({ paused: false, sentSignalKeys: [], latestSignal: null })
    );
    const state = new StateStore(file, 10);
    const loaded = await state.load();
    assert.equal(loaded.dashboardSettings, null);
    assert.deepEqual(loaded.signalHistory, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
