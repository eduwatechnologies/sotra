import { registerTelegramController } from "./controllers/telegram-controller";
import { loadConfig, type AppConfig } from "./config";
import { safeErrorText } from "./logging";
import { fetchCandles } from "./services/market-data";
import { Telegraf } from "telegraf";
import { SignalScanner } from "./services/scanner";
import { ScanScheduler } from "./services/scheduler";
import { StateStore } from "./models/state";
import { withStartupTimeout } from "./startup-timeout";
import { formatSignal } from "./views/telegram-view";

const TELEGRAM_STARTUP_TIMEOUT_MS = 15_000;

export async function startApplication(config: AppConfig = loadConfig()): Promise<void> {
  console.info("Loading Sotra Signals state...");
  const state = new StateStore(config.stateFile, config.maxStoredSignalKeys);
  await state.load();
  console.info("Local state loaded.");

  let bot: Telegraf | undefined;
  const scanner = new SignalScanner(config, state, {
    fetchCandles,
    publish: async (signal) => {
      if (!bot) {
        throw new Error("Telegram bot is not initialized.");
      }
      await bot.telegram.sendMessage(config.telegramChatId, formatSignal(signal));
    },
    logError: (message, error) =>
      console.error(
        `${message} ${safeErrorText(error, [config.telegramBotToken, config.twelveDataApiKey])}`
      ),
  });
  bot = new Telegraf(config.telegramBotToken);
  registerTelegramController(bot, config, scanner, state);

  let authenticated = false;
  let resolveAuthentication!: () => void;
  let rejectAuthentication!: (error: unknown) => void;
  const authentication = new Promise<void>((resolve, reject) => {
    resolveAuthentication = resolve;
    rejectAuthentication = reject;
  });

  const polling = bot.launch(() => {
    authenticated = true;
    resolveAuthentication();
  });
  void polling.catch((error: unknown) => {
    if (!authenticated) {
      rejectAuthentication(error);
      return;
    }

    console.error(
      `Telegram polling stopped. ${safeErrorText(error, [
        config.telegramBotToken,
        config.twelveDataApiKey,
      ])}`
    );
    scheduler.stop();
    process.exitCode = 1;
  });

  const scheduler = new ScanScheduler({
    intervalMs: config.scanIntervalMs,
    run: async () => {
      if (state.get().paused) {
        return;
      }
      await scanner.scan({ publishAlerts: true, scheduled: true });
    },
    onError: (error) => {
      console.error(
        `Scheduled scan failed. ${safeErrorText(error, [
          config.telegramBotToken,
          config.twelveDataApiKey,
        ])}`
      );
    },
  });

  const handleShutdown = (signal: NodeJS.Signals): void => {
    console.info(`Shutting down (${signal}).`);
    scheduler.stop();
    if (authenticated && bot) {
      bot.stop(signal);
    } else {
      bot?.telegram.options.agent?.destroy();
    }
  };
  process.once("SIGINT", () => handleShutdown("SIGINT"));
  process.once("SIGTERM", () => handleShutdown("SIGTERM"));

  console.info(
    `Connecting to Telegram. Authentication will time out after ${
      TELEGRAM_STARTUP_TIMEOUT_MS / 1000
    } seconds.`
  );
  await withStartupTimeout(
    authentication,
    TELEGRAM_STARTUP_TIMEOUT_MS,
    () => {
      bot?.telegram.options.agent?.destroy();
    },
    "Telegram authentication"
  );

  console.info(
    `Telegram authenticated as @${bot.botInfo?.username ?? "bot"}; long polling is running.`
  );
  scheduler.start();
}
