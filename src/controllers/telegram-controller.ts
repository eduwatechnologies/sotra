import type { Telegraf } from "telegraf";
import type { AppConfig } from "../config";
import { safeErrorText } from "../logging";
import type { SignalScanner } from "../services/scanner";
import type { StateRepository } from "../models/state";
import {
  formatMarkets,
  formatScanResults,
  formatSignal,
  formatStatus,
  formatWelcome,
} from "../views/telegram-view";

export function registerTelegramController(
  bot: Telegraf,
  config: AppConfig,
  scanner: SignalScanner,
  state: StateRepository
): void {
  bot.use(async (ctx, next) => {
    const message = ctx.message && "text" in ctx.message ? ctx.message.text : undefined;
    if (message?.startsWith("/") && String(ctx.chat?.id) !== config.telegramChatId) {
      await ctx.reply("This bot is private.");
      return;
    }
    await next();
  });

  bot.start(async (ctx) => {
    await ctx.reply(formatWelcome());
  });

  bot.command("status", async (ctx) => {
    await ctx.reply(formatStatus(config, (await state.get()).paused));
  });

  bot.command("markets", async (ctx) => {
    await ctx.reply(formatMarkets(config.symbols));
  });

  bot.command("scan", async (ctx) => {
    try {
      const pausedAtStart = (await state.get()).paused;
      const results = await scanner.scan({
        publishAlerts: !pausedAtStart,
        scheduled: false,
      });
      await ctx.reply(formatScanResults(results, pausedAtStart || (await state.get()).paused));
    } catch (error) {
      if (error instanceof Error && error.message === "A market scan is already running.") {
        await ctx.reply("A scan is already running. Please try again shortly.");
        return;
      }
      console.error(
        `Manual scan failed. ${safeErrorText(error, [
          config.telegramBotToken,
          config.twelveDataApiKey,
        ])}`
      );
      await ctx.reply("The scan could not be completed. Check the service logs.");
    }
  });

  bot.command("last", async (ctx) => {
    const signal = (await state.get()).latestSignal;
    await ctx.reply(signal ? formatSignal(signal) : "No signal has been detected yet.");
  });

  bot.command("pause", async (ctx) => {
    await state.setPaused(true);
    await ctx.reply("Scheduled signal alerts are paused. Use /resume to turn them back on.");
  });

  bot.command("resume", async (ctx) => {
    await state.setPaused(false);
    await ctx.reply("Scheduled signal alerts are resumed.");
  });

  bot.catch((error) => {
    console.error(
      `Telegram handler error. ${safeErrorText(error, [
        config.telegramBotToken,
        config.twelveDataApiKey,
      ])}`
    );
  });
}
