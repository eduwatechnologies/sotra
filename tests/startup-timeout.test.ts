import assert from "node:assert/strict";
import test from "node:test";
import { withStartupTimeout } from "../src/startup-timeout";

test("returns the startup result before the deadline", async () => {
  assert.equal(await withStartupTimeout(Promise.resolve("ready"), 100, () => assert.fail()), "ready");
});

test("runs cleanup and reports an explicit error when startup hangs", async () => {
  let cleanedUp = false;
  await assert.rejects(
    withStartupTimeout(new Promise<never>(() => undefined), 10, () => {
      cleanedUp = true;
    }, "Telegram connection"),
    /Telegram connection timed out after 0\.01 seconds/
  );
  assert.equal(cleanedUp, true);
});
