import type { AppConfig } from "../config";
import type { Candle, Signal, SignalDirection } from "../models/domain";
import { fetchCandles } from "./market-data";
import { analyzeCandles } from "./strategy";

export const MORNING_REPORT_TIMEZONE = "Africa/Lagos";
export const MORNING_REPORT_TIMEFRAMES = {
  bias: "4h",
  setup: "1h",
  entry: "5min",
} as const;

const INTERVAL_MS = {
  "4h": 4 * 60 * 60_000,
  "1h": 60 * 60_000,
  "5min": 5 * 60_000,
} as const;
const SWING_WING = 2;
const ORDER_BLOCK_LOOKBACK = 12;

export interface PriceZone {
  low: number;
  high: number;
}

export interface MorningReportEntry {
  symbol: string;
  error?: string;
  bias: "bullish" | "bearish" | "neutral";
  biasExplanation: string;
  trendline: "aligned" | "not aligned" | "unavailable";
  marketStructureShift: "confirmed" | "not confirmed" | "unavailable";
  orderBlock: PriceZone | null;
  entrySignal: Signal | null;
  entryExplanation: string;
  staleTimeframes: string[];
}

export interface MorningReportDependencies {
  fetchCandles: typeof fetchCandles;
  now?: () => number;
}

interface SwingPoint {
  index: number;
  value: number;
}

function getFulfilledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") {
    throw result.reason;
  }
  return result.value;
}

function completedCandles(candles: Candle[], interval: keyof typeof INTERVAL_MS, now: number): Candle[] {
  const duration = INTERVAL_MS[interval];
  return candles
    .filter((candle) => candle.timestamp + duration <= now)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function findSwingPoints(
  candles: Candle[],
  kind: "high" | "low"
): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let index = SWING_WING; index < candles.length - SWING_WING; index += 1) {
    const value = kind === "high" ? candles[index].high : candles[index].low;
    const neighbors = [
      ...candles.slice(index - SWING_WING, index),
      ...candles.slice(index + 1, index + SWING_WING + 1),
    ];
    const isSwing = neighbors.every((candle) =>
      kind === "high" ? value > candle.high : value < candle.low
    );
    if (isSwing) {
      points.push({ index, value });
    }
  }
  return points;
}

function determineBias(candles: Candle[]): MorningReportEntry["bias"] {
  const highs = findSwingPoints(candles, "high").slice(-2);
  const lows = findSwingPoints(candles, "low").slice(-2);
  if (highs.length < 2 || lows.length < 2) {
    return "neutral";
  }
  const higherHighs = highs[1].value > highs[0].value;
  const higherLows = lows[1].value > lows[0].value;
  const lowerHighs = highs[1].value < highs[0].value;
  const lowerLows = lows[1].value < lows[0].value;
  if (higherHighs && higherLows) {
    return "bullish";
  }
  if (lowerHighs && lowerLows) {
    return "bearish";
  }
  return "neutral";
}

function findTrendlineAlignment(
  candles: Candle[],
  direction: SignalDirection
): boolean {
  const kind = direction === "BUY" ? "low" : "high";
  const points = findSwingPoints(candles, kind).slice(-2);
  if (points.length < 2) {
    return false;
  }
  return direction === "BUY"
    ? points[1].value > points[0].value
    : points[1].value < points[0].value;
}

function hasStructureShift(candles: Candle[], direction: SignalDirection): boolean {
  const latest = candles.at(-1);
  const pivots = findSwingPoints(candles, direction === "BUY" ? "high" : "low");
  const pivot = pivots.at(-1);
  if (!latest || !pivot || pivot.index >= candles.length - 1) {
    return false;
  }
  return direction === "BUY" ? latest.close > pivot.value : latest.close < pivot.value;
}

function findOrderBlock(
  candles: Candle[],
  direction: SignalDirection
): PriceZone | null {
  const lastIndex = candles.length - 2;
  const firstIndex = Math.max(0, lastIndex - ORDER_BLOCK_LOOKBACK + 1);
  for (let index = lastIndex; index >= firstIndex; index -= 1) {
    const candle = candles[index];
    const opposing = direction === "BUY"
      ? candle.close < candle.open
      : candle.close > candle.open;
    if (opposing) {
      return { low: candle.low, high: candle.high };
    }
  }
  return null;
}

function hoursSinceLastCompleted(
  candles: Candle[],
  interval: keyof typeof INTERVAL_MS,
  now: number
): number {
  const latest = candles.at(-1);
  return latest ? Math.max(0, (now - latest.timestamp - INTERVAL_MS[interval]) / 3_600_000) : Infinity;
}

function baseEntry(symbol: string): MorningReportEntry {
  return {
    symbol,
    bias: "neutral",
    biasExplanation: "Insufficient completed 4H swing data.",
    trendline: "unavailable",
    marketStructureShift: "unavailable",
    orderBlock: null,
    entrySignal: null,
    entryExplanation: "No aligned 5-minute entry setup.",
    staleTimeframes: [],
  };
}

export function analyzeMorningSetup(
  symbol: string,
  input: Record<keyof typeof MORNING_REPORT_TIMEFRAMES, Candle[]>,
  config: AppConfig,
  now = Date.now()
): MorningReportEntry {
  const fourHour = completedCandles(input.bias, "4h", now);
  const oneHour = completedCandles(input.setup, "1h", now);
  const fiveMinute = completedCandles(input.entry, "5min", now);
  const result = baseEntry(symbol);

  if (hoursSinceLastCompleted(fourHour, "4h", now) > 12) {
    result.staleTimeframes.push("4H");
  }
  if (hoursSinceLastCompleted(oneHour, "1h", now) > 3) {
    result.staleTimeframes.push("1H");
  }
  if (hoursSinceLastCompleted(fiveMinute, "5min", now) * 60 > config.maxCandleAgeMinutes) {
    result.staleTimeframes.push("5M");
  }

  if (!result.staleTimeframes.includes("4H")) {
    result.bias = determineBias(fourHour);
    result.biasExplanation = result.bias === "bullish"
      ? "Recent 4H swings show higher highs and higher lows."
      : result.bias === "bearish"
        ? "Recent 4H swings show lower highs and lower lows."
        : "Recent 4H swings do not show a clear higher-high/higher-low or lower-high/lower-low sequence.";
  } else {
    result.biasExplanation = "Latest completed 4H data is stale; bias withheld.";
  }

  if (result.bias === "neutral" || result.staleTimeframes.includes("1H")) {
    if (result.bias !== "neutral") {
      result.marketStructureShift = "unavailable";
    }
    if (result.staleTimeframes.includes("1H")) {
      result.marketStructureShift = "unavailable";
    }
    return result;
  }

  const direction: SignalDirection = result.bias === "bullish" ? "BUY" : "SELL";
  result.trendline = findTrendlineAlignment(oneHour, direction) ? "aligned" : "not aligned";
  const shifted = hasStructureShift(oneHour, direction);
  result.marketStructureShift = shifted ? "confirmed" : "not confirmed";
  if (shifted) {
    result.orderBlock = findOrderBlock(oneHour, direction);
  }

  if (
    !result.staleTimeframes.includes("5M") &&
    result.trendline === "aligned" &&
    shifted
  ) {
    const signal = analyzeCandles(
      fiveMinute,
      symbol,
      config,
      now,
      false
    );
    if (signal?.direction === direction) {
      result.entrySignal = signal;
      result.entryExplanation = "5-minute liquidity sweep and structure confirmation align with the 4H bias.";
    }
  }
  return result;
}

export async function generateMorningReport(
  config: AppConfig,
  dependencies: MorningReportDependencies
): Promise<MorningReportEntry[]> {
  const now = dependencies.now?.() ?? Date.now();
  const results: MorningReportEntry[] = [];
  for (const symbol of config.symbols) {
    try {
      const responses = await Promise.allSettled([
        dependencies.fetchCandles(symbol, MORNING_REPORT_TIMEFRAMES.bias, config.twelveDataApiKey),
        dependencies.fetchCandles(symbol, MORNING_REPORT_TIMEFRAMES.setup, config.twelveDataApiKey),
        dependencies.fetchCandles(symbol, MORNING_REPORT_TIMEFRAMES.entry, config.twelveDataApiKey),
      ]);
      const candles = {
        bias: getFulfilledValue(responses[0]),
        setup: getFulfilledValue(responses[1]),
        entry: getFulfilledValue(responses[2]),
      };
      results.push(analyzeMorningSetup(symbol, candles, config, now));
    } catch (error) {
      results.push({
        ...baseEntry(symbol),
        error: error instanceof Error ? error.message : "Market report data could not be fetched.",
      });
    }
  }
  return results;
}
