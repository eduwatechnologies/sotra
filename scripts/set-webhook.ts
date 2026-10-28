import "dotenv/config";
import { Telegraf } from "telegraf";
import { safeErrorText } from "../src/logging";

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const host = process.argv[2] ?? process.env.VERCEL_URL;
  if (!token || !secret || !host) {
    throw new Error(
      "Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET, and pass the deployed URL or set VERCEL_URL."
    );
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET must contain 1-256 letters, numbers, underscores, or hyphens.");
  }

  const baseUrl = host.startsWith("http://") || host.startsWith("https://")
    ? host
    : `https://${host}`;
  const webhookUrl = new URL("/api/telegram", baseUrl).toString();
  const bot = new Telegraf(token);
  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: secret,
    allowed_updates: ["message"],
  });
  console.info(`Telegram webhook configured for ${new URL(webhookUrl).host}.`);
}

main().catch((error: unknown) => {
  console.error(
    `Failed to configure Telegram webhook. ${safeErrorText(error, [
      process.env.TELEGRAM_BOT_TOKEN ?? "",
      process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
    ])}`
  );
  process.exitCode = 1;
});
