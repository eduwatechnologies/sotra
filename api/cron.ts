import { timingSafeEqual } from "node:crypto";
import { getVercelRuntime } from "../src/vercel-runtime";
import { safeErrorText } from "../src/logging";
import type { FunctionRequest, FunctionResponse } from "../src/platform/vercel-http-types";
import { formatMorningReport } from "../src/views/telegram-view";

export const config = {
  maxDuration: 60,
};

export default async function scheduledMorningReport(
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
    if ((await runtime.state.get()).paused) {
      response.status(200).json({ sent: false, paused: true });
      return;
    }
    if (!(await runtime.state.acquireScanLock())) {
      response.status(409).json({ error: "A market scan is already running." });
      return;
    }

    try {
      const results = await runtime.generateMorningReport();
      await runtime.bot.telegram.sendMessage(
        runtime.config.telegramChatId,
        formatMorningReport(results)
      );
      const failed = results.filter((result) => result.error);
      response.status(200).json({
        sent: true,
        symbols: results.length,
        unavailable: failed.length,
        results: results.map(({ symbol, error, bias }) => ({
          symbol,
          bias,
          status: error ? "error" : "reported",
        })),
      });
    } finally {
      await runtime.state.releaseScanLock();
    }
  } catch (error) {
    console.error(
      `Vercel morning report failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.TWELVE_DATA_API_KEY ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
      ])}`
    );
    response.status(500).json({ error: "Morning report failed" });
  }
}
