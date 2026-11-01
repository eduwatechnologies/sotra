import { safeErrorText } from "../../src/logging";
import type { FunctionRequest, FunctionResponse } from "../../src/platform/vercel-http-types";
import { getVercelRuntime } from "../../src/vercel-runtime";
import { isAuthorizedDashboardRequest } from "../dashboard-auth";

export default async function dashboardPerformance(
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
    const [strategies, signals] = await Promise.all([
      runtime.signalHistory.getStrategyPerformance(),
      runtime.signalHistory.getRecentSignals(25),
    ]);
    response.status(200).json({
      strategies,
      signals: signals.map(
        ({ id, signal, strategy, detectedAt, deliveryStatus, outcome, outcomeAt }) => ({
          id,
          signal,
          strategy: { id: strategy.id, name: strategy.name },
          detectedAt,
          deliveryStatus,
          outcome,
          outcomeAt,
        })
      ),
    });
  } catch (error) {
    console.error(
      `Dashboard performance request failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.DATABASE_URL ?? "",
        process.env.DASHBOARD_API_SECRET ?? "",
      ])}`
    );
    response.status(500).json({ error: "Signal performance is unavailable" });
  }
}
