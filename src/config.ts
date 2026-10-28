import path from "node:path";

export interface AppConfig {
  telegramBotToken: string;
  telegramChatId: string;
  twelveDataApiKey: string;
  symbols: string[];
  interval: string;
  scanIntervalMs: number;
  minRewardRisk: number;
  swingLookback: number;
  structureLookback: number;
  maxCandleAgeMinutes: number;
  maxStoredSignalKeys: number;
  stateFile: string;
  stateBackend: "file" | "upstash";
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  integer = false
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : defaultValue;
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be a positive${integer ? " integer" : " number"}.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const telegramChatId = required(env, "TELEGRAM_CHAT_ID");
  if (!/^-?\d+$/.test(telegramChatId)) {
    throw new Error("TELEGRAM_CHAT_ID must be a numeric Telegram chat ID.");
  }

  const symbols = (env.SYMBOLS ?? "XAU/USD,EUR/USD,GBP/USD")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  if (symbols.length === 0 || symbols.some((symbol) => !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(symbol))) {
    throw new Error("SYMBOLS must be a comma-separated list such as XAU/USD,EUR/USD.");
  }

  const interval = env.INTERVAL?.trim() || "5min";
  if (!/^\d+(min|h|day|week|month)$/.test(interval)) {
    throw new Error("INTERVAL must use a supported format such as 5min or 1h.");
  }

  const defaultStateBackend = env.VERCEL === "1" ? "upstash" : "file";
  const stateBackend = env.STATE_BACKEND?.trim() || defaultStateBackend;
  if (stateBackend !== "file" && stateBackend !== "upstash") {
    throw new Error("STATE_BACKEND must be either file or upstash.");
  }
  if (env.VERCEL === "1" && stateBackend !== "upstash") {
    throw new Error("Vercel deployments require STATE_BACKEND=upstash.");
  }

  return {
    telegramBotToken: required(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId,
    twelveDataApiKey: required(env, "TWELVE_DATA_API_KEY"),
    symbols: [...new Set(symbols)],
    interval,
    scanIntervalMs: positiveNumber(env, "SCAN_INTERVAL_MS", 1_800_000, true),
    minRewardRisk: positiveNumber(env, "MIN_REWARD_RISK", 2),
    swingLookback: positiveNumber(env, "SWING_LOOKBACK", 10, true),
    structureLookback: positiveNumber(env, "STRUCTURE_LOOKBACK", 5, true),
    maxCandleAgeMinutes: positiveNumber(env, "MAX_CANDLE_AGE_MINUTES", 20),
    maxStoredSignalKeys: positiveNumber(env, "MAX_STORED_SIGNAL_KEYS", 1_000, true),
    stateFile: path.resolve(env.STATE_FILE?.trim() || path.join("data", "state.json")),
    stateBackend,
  };
}
