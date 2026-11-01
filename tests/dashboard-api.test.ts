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
import updateDashboardSettings from "../api/dashboard/settings";
import dashboardStrategies from "../api/dashboard/strategies";
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

test("strategy profile API requires the dashboard bearer secret", async () => {
  const wrongMethod = new MockResponse();
  await dashboardStrategies(request("PUT"), wrongMethod as FunctionResponse);
  assert.equal(wrongMethod.statusCode, 405);

  const unauthorized = new MockResponse();
  await dashboardStrategies(request("GET"), unauthorized as FunctionResponse);
  assert.equal(unauthorized.statusCode, 401);
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

    const settings = new MockResponse();
    await updateDashboardSettings(
      request("POST", "test-dashboard-key", {
        settings: {
          symbols: ["GBP/USD"],
          interval: "15min",
          scanIntervalMs: 600_000,
          minRewardRisk: 2.5,
        },
      }),
      settings as FunctionResponse
    );
    assert.equal(settings.statusCode, 200);

    const settingsStatus = new MockResponse();
    await dashboardStatus(
      request("GET", "test-dashboard-key"),
      settingsStatus as FunctionResponse
    );
    assert.deepEqual(settingsStatus.jsonBody, {
      paused: false,
      symbols: ["GBP/USD"],
      interval: "15min",
      scanIntervalMs: 600_000,
      minRewardRisk: 2.5,
      latestSignal: null,
    });

    const strategyCreate = new MockResponse();
    await dashboardStrategies(
      request("POST", "test-dashboard-key", {
        action: "create",
        name: "Wide structure",
        parameters: {
          minRewardRisk: 4,
          swingLookback: 12,
          structureLookback: 6,
          maxBarsSinceSweep: 2,
          atrPeriod: 14,
          maxRiskAtrMultiple: 1.5,
          maxCandleAgeMinutes: 15,
        },
      }),
      strategyCreate as FunctionResponse
    );
    assert.equal(strategyCreate.statusCode, 200);
    const created = strategyCreate.jsonBody as {
      profiles: Array<{ id: string; name: string }>;
      activeProfileId: string | null;
    };
    assert.equal(created.profiles[0].name, "Wide structure");
    assert.equal(created.activeProfileId, null);

    const activateStrategy = new MockResponse();
    await dashboardStrategies(
      request("POST", "test-dashboard-key", {
        action: "activate",
        profileId: created.profiles[0].id,
      }),
      activateStrategy as FunctionResponse
    );
    assert.equal(activateStrategy.statusCode, 200);
    assert.equal(
      (activateStrategy.jsonBody as typeof created).activeProfileId,
      created.profiles[0].id
    );

    const activeDelete = new MockResponse();
    await dashboardStrategies(
      request("POST", "test-dashboard-key", {
        action: "delete",
        profileId: created.profiles[0].id,
      }),
      activeDelete as FunctionResponse
    );
    assert.equal(activeDelete.statusCode, 409);

    const activeStatus = new MockResponse();
    await dashboardStatus(
      request("GET", "test-dashboard-key"),
      activeStatus as FunctionResponse
    );
    assert.equal(
      (activeStatus.jsonBody as { minRewardRisk: number }).minRewardRisk,
      4
    );

    const activateDefault = new MockResponse();
    await dashboardStrategies(
      request("POST", "test-dashboard-key", {
        action: "activate",
        profileId: null,
      }),
      activateDefault as FunctionResponse
    );
    assert.equal(activateDefault.statusCode, 200);

    const deleteStrategy = new MockResponse();
    await dashboardStrategies(
      request("POST", "test-dashboard-key", {
        action: "delete",
        profileId: created.profiles[0].id,
      }),
      deleteStrategy as FunctionResponse
    );
    assert.equal(deleteStrategy.statusCode, 200);

    const resetSettings = new MockResponse();
    await updateDashboardSettings(
      request("POST", "test-dashboard-key", { settings: null }),
      resetSettings as FunctionResponse
    );
    assert.equal(resetSettings.statusCode, 200);
    assert.deepEqual(resetSettings.jsonBody, {
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

test("dashboard settings endpoint validates authorization and all values", async () => {
  const previousSecret = process.env.DASHBOARD_API_SECRET;
  process.env.DASHBOARD_API_SECRET = "test-dashboard-key";
  try {
    const wrongMethod = new MockResponse();
    await updateDashboardSettings(
      request("GET", "test-dashboard-key"),
      wrongMethod as FunctionResponse
    );
    assert.equal(wrongMethod.statusCode, 405);

    const unauthorized = new MockResponse();
    await updateDashboardSettings(
      request("POST", undefined, { settings: null }),
      unauthorized as FunctionResponse
    );
    assert.equal(unauthorized.statusCode, 401);

    const invalid = new MockResponse();
    await updateDashboardSettings(
      request("POST", "test-dashboard-key", {
        settings: {
          symbols: ["not-a-market"],
          interval: "tomorrow",
          scanIntervalMs: 1,
          minRewardRisk: 0,
        },
      }),
      invalid as FunctionResponse
    );
    assert.equal(invalid.statusCode, 400);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.DASHBOARD_API_SECRET;
    } else {
      process.env.DASHBOARD_API_SECRET = previousSecret;
    }
  }
});
