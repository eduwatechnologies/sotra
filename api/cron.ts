import { timingSafeEqual } from "node:crypto";
import { getVercelRuntime } from "../src/vercel-runtime";
import { safeErrorText } from "../src/logging";
import type { FunctionRequest, FunctionResponse } from "../src/platform/vercel-http-types";

export const config = {
  maxDuration: 60,
};

export default async function scheduledScan(
  request: FunctionRequest,
  response: FunctionResponse
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.CRON_SECRET;
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (
    !secret ||
    Buffer.byteLength(provided) !== Buffer.byteLength(secret) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  ) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const runtime = await getVercelRuntime();
    const results = await runtime.scanner.scan({
      publishAlerts: true,
      scheduled: true,
    });
    const failed = results.filter((result) => result.status === "error");
    response.status(failed.length > 0 ? 502 : 200).json({
      scanned: results.length,
      failed: failed.length,
      results: results.map(({ symbol, status }) => ({ symbol, status })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "A market scan is already running.") {
      response.status(409).json({ error: error.message });
      return;
    }
    console.error(
      `Vercel scheduled scan failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.TWELVE_DATA_API_KEY ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
      ])}`
    );
    response.status(500).json({ error: "Scheduled scan failed" });
  }
}
