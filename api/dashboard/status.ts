import { safeErrorText } from "../../src/logging";
import type { FunctionRequest, FunctionResponse } from "../../src/platform/vercel-http-types";
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
    response.status(200).json({
      paused: state.paused,
      symbols: runtime.config.symbols,
      interval: runtime.config.interval,
      scanIntervalMs: runtime.config.scanIntervalMs,
      minRewardRisk: runtime.config.minRewardRisk,
      latestSignal: state.latestSignal,
    });
  } catch (error) {
    console.error(
      `Dashboard status request failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.TWELVE_DATA_API_KEY ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
        process.env.DASHBOARD_API_SECRET ?? "",
      ])}`
    );
    response.status(500).json({ error: "Dashboard status unavailable" });
  }
}
