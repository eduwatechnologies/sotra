import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { signalKey, StateStore } from "../src/models/state";
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

test("persists pause state, latest signal, and bounded deduplication keys", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-state-"));
  const file = path.join(directory, "state.json");
  try {
    const state = new StateStore(file, 2);
    await state.load();
    await state.setPaused(true);
    await state.recordLatestSignal(signal);
    await state.recordSentSignal(signalKey(signal));
    await state.recordSentSignal("second");
    await state.recordSentSignal("third");

    const restarted = new StateStore(file, 2);
    const loaded = await restarted.load();
    assert.equal(loaded.paused, true);
    assert.deepEqual(loaded.latestSignal, signal);
    assert.equal(loaded.sentSignalKeys.length, 2);
    assert.equal(await restarted.hasSent(signalKey(signal)), false);
    assert.equal(JSON.parse(await readFile(file, "utf8")).paused, true);
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
