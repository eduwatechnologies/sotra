import { safeErrorText } from "../src/logging";
import type { FunctionRequest, FunctionResponse } from "../src/platform/vercel-http-types";
import { getVercelRuntime } from "../src/vercel-runtime";

export const config = {
  maxDuration: 60,
};

function getWebhookSecret(): string {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET must be set and contain 1-256 letters, numbers, underscores, or hyphens."
    );
  }
  return secret;
}

export default async function telegramWebhook(
  request: FunctionRequest,
  response: FunctionResponse
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).send("Method not allowed");
    return;
  }

  try {
    const runtime = await getVercelRuntime();
    const handler = runtime.bot.webhookCallback("/api/telegram", {
      secretToken: getWebhookSecret(),
    });
    await handler(request, response);
  } catch (error) {
    console.error(
      `Telegram webhook failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
        process.env.TWELVE_DATA_API_KEY ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
      ])}`
    );
    if (!response.headersSent) {
      response.status(500).send("Webhook processing failed");
    }
  }
}
