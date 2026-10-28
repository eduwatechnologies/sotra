import { Telegraf } from "telegraf";
import { registerTelegramController } from "./controllers/telegram-controller";
import { loadConfig, type AppConfig } from "./config";
import { safeErrorText } from "./logging";
import { StateStore, type StateRepository } from "./models/state";
import { UpstashStateStore } from "./models/upstash-state";
import { fetchCandles } from "./services/market-data";
import { SignalScanner } from "./services/scanner";
import { ScanScheduler } from "./services/scheduler";
import { withStartupTimeout } from "./startup-timeout";
import { formatSignal } from "./views/telegram-view";

const TELEGRAM_STARTUP_TIMEOUT_MS = 15_000;

export interface ApplicationRuntime {
  config: AppConfig;
  bot: Telegraf;
  scanner: SignalScanner;
  state: StateRepository;
}

function createStateRepository(config: AppConfig): StateRepository {
  if (config.stateBackend === "upstash") {
    return UpstashStateStore.fromEnv(process.env, config.maxStoredSignalKeys);
  }
  return new StateStore(config.stateFile, config.maxStoredSignalKeys);
}

export async function createRuntime(
  config: AppConfig = loadConfig()
): Promise<ApplicationRuntime> {
  const state = createStateRepository(config);
  await state.load();

  const bot = new Telegraf(config.telegramBotToken);
  const scanner = new SignalScanner(config, state, {
    fetchCandles,
    publish: async (signal) => {
      await bot.telegram.sendMessage(config.telegramChatId, formatSignal(signal));
    },
    logError: (message, error) =>
      console.error(
        `${message} ${safeErrorText(error, [config.telegramBotToken, config.twelveDataApiKey])}`
      ),
  });
  registerTelegramController(bot, config, scanner, state);
  return { config, bot, scanner, state };
}

export async function startApplication(config: AppConfig = loadConfig()): Promise<void> {
  console.info("Loading Sotra Signals application...");
  const runtime = await createRuntime(config);
  const { bot, scanner, state } = runtime;

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
  let scheduler: ScanScheduler | undefined;
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
    scheduler?.stop();
    process.exitCode = 1;
  });

  scheduler = new ScanScheduler({
    intervalMs: config.scanIntervalMs,
    run: async () => {
      if (!(await state.get()).paused) {
        await scanner.scan({ publishAlerts: true, scheduled: true });
      }
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
    scheduler?.stop();
    if (authenticated) {
      bot.stop(signal);
    } else {
      bot.telegram.options.agent?.destroy();
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
      bot.telegram.options.agent?.destroy();
    },
    "Telegram authentication"
  );

  console.info(
    `Telegram authenticated as @${bot.botInfo?.username ?? "bot"}; long polling is running.`
  );
  scheduler.start();
}
