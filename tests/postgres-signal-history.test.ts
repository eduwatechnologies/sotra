import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresSignalHistoryStore } from "../src/models/postgres-signal-history";
import type { TrackedSignal } from "../src/models/signal-history";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

test(
  "PostgreSQL schema initialization and signal inserts are safe to retry",
  { skip: !testDatabaseUrl },
  async () => {
    const store = PostgresSignalHistoryStore.fromEnv({
      DATABASE_URL: testDatabaseUrl,
    });
    const signalId = randomUUID();
    const signal: TrackedSignal = {
      id: signalId,
      key: `test:${signalId}`,
      signal: {
        symbol: "EUR/USD",
        direction: "BUY",
        entry: 1.1,
        stopLoss: 1.09,
        takeProfit: 1.12,
        rewardRisk: 2,
        timestamp: Date.now(),
        rationale: "PostgreSQL integration test.",
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
      detectedAt: Date.now(),
      candleInterval: "5min",
      deliveryStatus: "not_attempted",
      outcome: "unresolved",
      outcomeAt: null,
    };

    try {
      await store.initialize();
      await store.initialize();
      const first = await store.recordDetectedSignal(signal);
      const duplicate = await store.recordDetectedSignal({
        ...signal,
        id: randomUUID(),
        strategy: { ...signal.strategy, name: "Changed after detection" },
      });

      assert.equal(first.id, signal.id);
      assert.equal(duplicate.id, signal.id);
      assert.equal(duplicate.strategy.name, "Default strategy");
      await store.updateDeliveryStatus(signal.key, "succeeded");
      await store.setSignalOutcome(signal.key, "win", Date.now());
      assert.equal((await store.getSignal(signal.key))?.outcome, "win");
    } finally {
      await store.close();
    }
  }
);
