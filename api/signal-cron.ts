import { getVercelRuntime } from "../src/vercel-runtime";
import { safeErrorText } from "../src/logging";
import type { FunctionRequest, FunctionResponse } from "../src/platform/vercel-http-types";
import { isAuthorizedCronRequest } from "./cron-auth";

export const config = {
  maxDuration: 60,
};

export default async function scheduledSignalScan(
  request: FunctionRequest,
  response: FunctionResponse
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!isAuthorizedCronRequest(request)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const runtime = await getVercelRuntime();
    if ((await runtime.state.get()).paused) {
      response.status(200).json({ sent: false, paused: true });
      return;
    }

    const results = await runtime.scanner.scan({ publishAlerts: true, scheduled: true });
    const failed = results.filter((result) => result.status === "error");
    response.status(200).json({
      sent: results.filter((result) => result.sent).length,
      symbols: results.length,
      unavailable: failed.length,
      results: results.map(({ symbol, status, sent }) => ({ symbol, status, sent })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "A market scan is already running.") {
      response.status(409).json({ error: "A market scan is already running." });
      return;
    }
    console.error(
      `Vercel scheduled signal scan failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.TWELVE_DATA_API_KEY ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
      ])}`
    );
    response.status(500).json({ error: "Scheduled signal scan failed" });
  }
}
