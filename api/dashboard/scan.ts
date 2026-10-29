import { safeErrorText } from "../../src/logging";
import type { FunctionRequest, FunctionResponse } from "../../src/platform/vercel-http-types";
import { getVercelRuntime } from "../../src/vercel-runtime";
import { isAuthorizedDashboardRequest } from "../dashboard-auth";

export const config = {
  maxDuration: 60,
};

export default async function dashboardScan(
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

  try {
    const runtime = await getVercelRuntime();
    const pausedAtStart = (await runtime.state.get()).paused;
    const results = await runtime.scanner.scan({
      publishAlerts: !pausedAtStart,
      scheduled: false,
    });
    response.status(200).json({
      paused: (await runtime.state.get()).paused,
      results: results.map(({ symbol, status, signal, sent }) => ({
        symbol,
        status,
        signal,
        sent,
        ...(status === "error" ? { error: "Unable to scan this market" } : {}),
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "A market scan is already running.") {
      response.status(409).json({ error: "A market scan is already running." });
      return;
    }
    console.error(
      `Dashboard manual scan failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.TWELVE_DATA_API_KEY ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
        process.env.DASHBOARD_API_SECRET ?? "",
      ])}`
    );
    response.status(500).json({ error: "Manual scan could not be completed" });
  }
}
