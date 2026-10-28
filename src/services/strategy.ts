import type { Candle, Signal, SignalDirection } from "../models/domain";

export interface StrategyConfig {
  swingLookback: number;
  structureLookback: number;
  minRewardRisk: number;
  maxCandleAgeMinutes: number;
}

function validCandle(candle: Candle): boolean {
  return (
    Number.isFinite(candle.timestamp) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high)
  );
}

function createSignal(
  symbol: string,
  direction: SignalDirection,
  entry: number,
  stopLoss: number,
  timestamp: number,
  rewardRisk: number,
  rationale: string
): Signal | null {
  const risk = direction === "BUY" ? entry - stopLoss : stopLoss - entry;
  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }
  const takeProfit = direction === "BUY" ? entry + risk * rewardRisk : entry - risk * rewardRisk;
  if (
    !Number.isFinite(takeProfit) ||
    (direction === "BUY" ? takeProfit <= entry : takeProfit >= entry)
  ) {
    return null;
  }
  return { symbol, direction, entry, stopLoss, takeProfit, rewardRisk, timestamp, rationale };
}

function findSignal(
  candles: Candle[],
  symbol: string,
  config: StrategyConfig,
  direction: SignalDirection,
  confirmation: Candle,
  confirmationIndex: number
): Signal | null {
  const firstPossibleSweep = Math.max(config.swingLookback, config.structureLookback);

  for (let sweepIndex = confirmationIndex - 1; sweepIndex >= firstPossibleSweep; sweepIndex -= 1) {
    const sweep = candles[sweepIndex];
    const liquidityWindow = candles.slice(sweepIndex - config.swingLookback, sweepIndex);
    const structureWindow = candles.slice(sweepIndex - config.structureLookback, sweepIndex);
    const liquidityLevel =
      direction === "BUY"
        ? Math.min(...liquidityWindow.map((candle) => candle.low))
        : Math.max(...liquidityWindow.map((candle) => candle.high));
    const structureLevel =
      direction === "BUY"
        ? Math.max(...structureWindow.map((candle) => candle.high))
        : Math.min(...structureWindow.map((candle) => candle.low));
    const swept =
      direction === "BUY"
        ? sweep.low < liquidityLevel && sweep.close > liquidityLevel
        : sweep.high > liquidityLevel && sweep.close < liquidityLevel;
    const confirmed =
      direction === "BUY" ? confirmation.close > structureLevel : confirmation.close < structureLevel;

    if (!swept || !confirmed) {
      continue;
    }

    const rationale =
      direction === "BUY"
        ? `Swept the prior ${config.swingLookback}-candle low and the latest completed candle closed above the ${config.structureLookback}-candle structure high.`
        : `Swept the prior ${config.swingLookback}-candle high and the latest completed candle closed below the ${config.structureLookback}-candle structure low.`;
    return createSignal(
      symbol,
      direction,
      confirmation.close,
      direction === "BUY" ? sweep.low : sweep.high,
      confirmation.timestamp,
      config.minRewardRisk,
      rationale
    );
  }
  return null;
}

export function analyzeCandles(
  input: Candle[],
  symbol: string,
  config: StrategyConfig,
  now = Date.now(),
  latestCandleIsForming = true
): Signal | null {
  if (
    !Number.isInteger(config.swingLookback) ||
    config.swingLookback < 1 ||
    !Number.isInteger(config.structureLookback) ||
    config.structureLookback < 1 ||
    !Number.isFinite(config.minRewardRisk) ||
    config.minRewardRisk <= 0 ||
    !Number.isFinite(config.maxCandleAgeMinutes) ||
    config.maxCandleAgeMinutes <= 0
  ) {
    throw new Error("Invalid strategy configuration.");
  }

  if (input.some((candle) => !validCandle(candle))) {
    return null;
  }
  const candles = [...input].sort((left, right) => left.timestamp - right.timestamp);
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index - 1].timestamp === candles[index].timestamp) {
      return null;
    }
  }

  const confirmationIndex = candles.length - (latestCandleIsForming ? 2 : 1);
  const minimumHistory = Math.max(config.swingLookback, config.structureLookback) +
    (latestCandleIsForming ? 3 : 2);
  if (confirmationIndex < 0 || candles.length < minimumHistory) {
    return null;
  }

  const confirmation = candles[confirmationIndex];
  const age = now - confirmation.timestamp;
  if (age < 0 || age > config.maxCandleAgeMinutes * 60_000) {
    return null;
  }

  const bullish = findSignal(candles, symbol, config, "BUY", confirmation, confirmationIndex);
  const bearish = findSignal(candles, symbol, config, "SELL", confirmation, confirmationIndex);
  if (bullish && bearish) {
    return null;
  }
  return bullish ?? bearish;
}
