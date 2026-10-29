import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Socket } from "node:net";
import test from "node:test";
import dashboardScan from "../api/dashboard/scan";
import dashboardStatus from "../api/dashboard/status";
import updateDashboardPause from "../api/dashboard/pause";
import { isAuthorizedDashboardRequest } from "../api/dashboard-auth";
import type { FunctionResponse } from "../src/platform/vercel-http-types";

class MockResponse extends ServerResponse<IncomingMessage> {
  jsonBody: unknown;

  constructor() {
    super(new IncomingMessage(new Socket()));
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.jsonBody = body;
    return this;
  }

  send(body: string): this {
    this.end(body);
    return this;
  }
}

function request(method: string, authorization?: string, body?: unknown): IncomingMessage {
  const incoming = new IncomingMessage(new Socket());
  incoming.method = method;
  if (authorization) {
    incoming.headers.authorization = authorization;
  }
  Object.assign(incoming, { body });
  return incoming;
}

test("dashboard API auth requires the separate configured bearer secret", () => {
  assert.equal(isAuthorizedDashboardRequest(request("GET", "Bearer dashboard-key"), "dashboard-key"), true);
  assert.equal(isAuthorizedDashboardRequest(request("GET", "cron-key"), "dashboard-key"), false);
  assert.equal(isAuthorizedDashboardRequest(request("GET"), "dashboard-key"), false);
  assert.equal(isAuthorizedDashboardRequest(request("GET", "Bearer dashboard-key"), ""), false);
});

test("dashboard status rejects unauthorized requests before runtime initialization", async () => {
  const response = new MockResponse();
  await dashboardStatus(request("GET"), response as FunctionResponse);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.jsonBody, { error: "Unauthorized" });
});

test("manual dashboard scans reject unauthorized requests before runtime initialization", async () => {
  const response = new MockResponse();
  await dashboardScan(request("POST"), response as FunctionResponse);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.jsonBody, { error: "Unauthorized" });
});

test("authorized dashboard requests read and update the shared bot state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sotra-dashboard-api-"));
  const environment = [
    "DASHBOARD_API_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "TWELVE_DATA_API_KEY",
    "STATE_BACKEND",
    "STATE_FILE",
    "SCAN_INTERVAL_MS",
    "MIN_REWARD_RISK",
    "VERCEL",
  ] as const;
  const previous = new Map(
    environment.map((key) => [key, process.env[key]] as const)
  );
  Object.assign(process.env, {
    DASHBOARD_API_SECRET: "test-dashboard-key",
    TELEGRAM_BOT_TOKEN: "test-telegram-token",
    TELEGRAM_CHAT_ID: "123",
    TWELVE_DATA_API_KEY: "test-market-data-key",
    STATE_BACKEND: "file",
    STATE_FILE: path.join(directory, "state.json"),
    SCAN_INTERVAL_MS: "1800000",
    MIN_REWARD_RISK: "3",
    VERCEL: "0",
  });

  try {
    const status = new MockResponse();
    await dashboardStatus(
      request("GET", "Bearer test-dashboard-key"),
      status as FunctionResponse
    );
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.jsonBody, {
      paused: false,
      symbols: ["XAU/USD", "EUR/USD", "GBP/USD"],
      interval: "5min",
      scanIntervalMs: 1_800_000,
      minRewardRisk: 3,
      latestSignal: null,
    });

    const pause = new MockResponse();
    await updateDashboardPause(
      request("POST", "Bearer test-dashboard-key", { paused: true }),
      pause as FunctionResponse
    );
    assert.equal(pause.statusCode, 200);
    assert.deepEqual(pause.jsonBody, { paused: true });

    const refreshed = new MockResponse();
    await dashboardStatus(
      request("GET", "Bearer test-dashboard-key"),
      refreshed as FunctionResponse
    );
    assert.equal(refreshed.statusCode, 200);
    assert.equal(
      (refreshed.jsonBody as { paused: boolean }).paused,
      true
    );
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("dashboard pause endpoint validates its method, auth, and body", async () => {
  const previousSecret = process.env.DASHBOARD_API_SECRET;
  process.env.DASHBOARD_API_SECRET = "test-dashboard-key";
  try {
    const wrongMethod = new MockResponse();
    await updateDashboardPause(
      request("GET", "Bearer test-dashboard-key"),
      wrongMethod as FunctionResponse
    );
    assert.equal(wrongMethod.statusCode, 405);

    const unauthorized = new MockResponse();
    await updateDashboardPause(
      request("POST", undefined, { paused: true }),
      unauthorized as FunctionResponse
    );
    assert.equal(unauthorized.statusCode, 401);

    const invalidBody = new MockResponse();
    await updateDashboardPause(
      request("POST", "Bearer test-dashboard-key", { paused: "true" }),
      invalidBody as FunctionResponse
    );
    assert.equal(invalidBody.statusCode, 400);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.DASHBOARD_API_SECRET;
    } else {
      process.env.DASHBOARD_API_SECRET = previousSecret;
    }
  }
});
