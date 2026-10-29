import { safeErrorText } from "../../src/logging";
import type { FunctionRequest, FunctionResponse } from "../../src/platform/vercel-http-types";
import { getVercelRuntime } from "../../src/vercel-runtime";
import { isAuthorizedDashboardRequest } from "../dashboard-auth";

type DashboardRequest = FunctionRequest & { body?: unknown };

export default async function updateDashboardPause(
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
    !("paused" in body) ||
    typeof body.paused !== "boolean" ||
    Object.keys(body).length !== 1
  ) {
    response.status(400).json({ error: "Expected a boolean paused value" });
    return;
  }

  try {
    const runtime = await getVercelRuntime();
    await runtime.state.setPaused(body.paused);
    response.status(200).json({ paused: body.paused });
  } catch (error) {
    console.error(
      `Dashboard pause update failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
        process.env.DASHBOARD_API_SECRET ?? "",
      ])}`
    );
    response.status(500).json({ error: "Alert state could not be updated" });
  }
}
