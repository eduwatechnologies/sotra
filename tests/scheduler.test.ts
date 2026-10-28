import assert from "node:assert/strict";
import test from "node:test";
import { ScanScheduler } from "../src/services/scheduler";

test("waits for each scheduled run to finish before starting the next", async () => {
  let releaseFirstRun!: () => void;
  let startedRuns = 0;
  let concurrentRuns = 0;
  let maximumConcurrentRuns = 0;
  const firstRun = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });
  const scheduler = new ScanScheduler({
    intervalMs: 10,
    run: async () => {
      startedRuns += 1;
      concurrentRuns += 1;
      maximumConcurrentRuns = Math.max(maximumConcurrentRuns, concurrentRuns);
      if (startedRuns === 1) {
        await firstRun;
      }
      concurrentRuns -= 1;
    },
    onError: (error) => assert.fail(String(error)),
  });

  scheduler.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(startedRuns, 1);
  releaseFirstRun();
  await new Promise((resolve) => setTimeout(resolve, 30));
  scheduler.stop();

  assert.ok(startedRuns > 1);
  assert.equal(maximumConcurrentRuns, 1);
});

test("stops scheduling after a failed run and reports the error", async () => {
  let reportedError: unknown;
  let runCount = 0;
  const scheduler = new ScanScheduler({
    intervalMs: 10,
    run: async () => {
      runCount += 1;
      throw new Error("scan failure");
    },
    onError: (error) => {
      reportedError = error;
      scheduler.stop();
    },
  });

  scheduler.start();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(runCount, 1);
  assert.equal((reportedError as Error).message, "scan failure");
});
