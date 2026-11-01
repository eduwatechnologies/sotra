import { safeErrorText } from "../../src/logging";
import type { FunctionRequest, FunctionResponse } from "../../src/platform/vercel-http-types";
import { applyDashboardSettings } from "../../src/dashboard-settings";
import { applyStrategyProfile } from "../../src/strategy-profiles";
import { getVercelRuntime } from "../../src/vercel-runtime";
import { isAuthorizedDashboardRequest } from "../dashboard-auth";

export default async function dashboardStatus(
  request: FunctionRequest,
  response: FunctionResponse
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!isAuthorizedDashboardRequest(request)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const runtime = await getVercelRuntime();
    const state = await runtime.state.get();
    const config = applyStrategyProfile(
      applyDashboardSettings(runtime.config, state.dashboardSettings),
      state.strategyProfiles,
      state.activeStrategyProfileId
    );
    response.status(200).json({
      paused: state.paused,
      symbols: config.symbols,
      interval: config.interval,
      scanIntervalMs: config.scanIntervalMs,
      minRewardRisk: config.minRewardRisk,
      latestSignal: state.latestSignal,
    });
  } catch (error) {
    console.error(
      `Dashboard status request failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.TWELVE_DATA_API_KEY ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
        process.env.DATABASE_URL ?? "",
        process.env.DASHBOARD_API_SECRET ?? "",
      ])}`
    );
    response.status(500).json({ error: "Dashboard status unavailable" });
  }
}
