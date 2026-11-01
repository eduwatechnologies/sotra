import { safeErrorText } from "../../src/logging";
import {
  applyDashboardSettings,
  isDashboardSettings,
  type DashboardSettings,
} from "../../src/dashboard-settings";
import type { FunctionRequest, FunctionResponse } from "../../src/platform/vercel-http-types";
import { getVercelRuntime } from "../../src/vercel-runtime";
import { isAuthorizedDashboardRequest } from "../dashboard-auth";

type DashboardRequest = FunctionRequest & { body?: unknown };

export default async function updateDashboardSettings(
  request: FunctionRequest,
  response: FunctionResponse
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!isAuthorizedDashboardRequest(request)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = (request as DashboardRequest).body;
  if (
    body === null ||
    typeof body !== "object" ||
    !("settings" in body) ||
    Object.keys(body).length !== 1 ||
    !(body.settings === null || isDashboardSettings(body.settings))
  ) {
    response.status(400).json({
      error: "Expected valid settings or null to restore the configured defaults",
    });
    return;
  }

  try {
    const runtime = await getVercelRuntime();
    const settings = body.settings as DashboardSettings | null;
    await runtime.state.setDashboardSettings(settings);
    const currentState = await runtime.state.get();
    const config = applyDashboardSettings(
      runtime.config,
      currentState.dashboardSettings
    );
    response.status(200).json({
      paused: currentState.paused,
      symbols: config.symbols,
      interval: config.interval,
      scanIntervalMs: config.scanIntervalMs,
      minRewardRisk: config.minRewardRisk,
      latestSignal: currentState.latestSignal,
    });
  } catch (error) {
    console.error(
      `Dashboard settings update failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
        process.env.DATABASE_URL ?? "",
        process.env.DASHBOARD_API_SECRET ?? "",
      ])}`
    );
    response.status(500).json({ error: "Dashboard settings could not be updated" });
  }
}
