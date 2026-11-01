import { isSignal, type Signal, type Candle } from "./domain";
import {
  isStrategyParameters,
  type StrategyParameters,
} from "../strategy-profiles";

export type SignalDeliveryStatus =
  | "not_attempted"
  | "attempting"
  | "succeeded"
  | "failed";

export type SignalOutcome = "unresolved" | "ambiguous" | "win" | "loss";

export interface StrategySnapshot {
  id: string;
  name: string;
  parameters: StrategyParameters;
}

export interface TrackedSignal {
  id: string;
  key: string;
  signal: Signal;
  strategy: StrategySnapshot;
  detectedAt: number;
  candleInterval: string;
  deliveryStatus: SignalDeliveryStatus;
  outcome: SignalOutcome;
  outcomeAt: number | null;
}

export interface StrategyPerformance {
  strategyId: string;
  strategyName: string;
  total: number;
  wins: number;
  losses: number;
  unresolved: number;
  winRate: number | null;
}

export interface SignalHistoryRepository {
  recordDetectedSignal(record: TrackedSignal): Promise<TrackedSignal>;
  getSignal(key: string): Promise<TrackedSignal | null>;
  updateDeliveryStatus(key: string, status: SignalDeliveryStatus): Promise<void>;
  getUnresolvedSignals(symbol: string): Promise<TrackedSignal[]>;
  setSignalOutcome(key: string, outcome: "ambiguous" | "win" | "loss", at: number): Promise<void>;
  getStrategyPerformance(): Promise<StrategyPerformance[]>;
  getRecentSignals(limit: number): Promise<TrackedSignal[]>;
}

export function isTrackedSignal(value: unknown): value is TrackedSignal {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.key !== "string" ||
    typeof record.candleInterval !== "string" ||
    !/^\d+(min|h|day|week|month)$/.test(record.candleInterval) ||
    !isSignal(record.signal) ||
    record.strategy === null ||
    typeof record.strategy !== "object" ||
    !Number.isFinite(record.detectedAt) ||
    !["not_attempted", "attempting", "succeeded", "failed"].includes(
      String(record.deliveryStatus)
    ) ||
    !["unresolved", "ambiguous", "win", "loss"].includes(String(record.outcome)) ||
    !(record.outcomeAt === null || Number.isFinite(record.outcomeAt))
  ) {
    return false;
  }
  const strategy = record.strategy as Record<string, unknown>;
  return (
    typeof strategy.id === "string" &&
    typeof strategy.name === "string" &&
    isStrategyParameters(strategy.parameters)
  );
}

export function strategyPerformance(
  signals: TrackedSignal[]
): StrategyPerformance[] {
  const grouped = new Map<string, StrategyPerformance>();
  for (const { strategy, outcome } of signals) {
    let performance = grouped.get(strategy.id);
    if (!performance) {
      performance = {
        strategyId: strategy.id,
        strategyName: strategy.name,
        total: 0,
        wins: 0,
        losses: 0,
        unresolved: 0,
        winRate: null,
      };
      grouped.set(strategy.id, performance);
    }
    performance.total += 1;
    if (outcome === "win") {
      performance.wins += 1;
    } else if (outcome === "loss") {
      performance.losses += 1;
    } else {
      performance.unresolved += 1;
    }
  }
  return [...grouped.values()]
    .map((performance) => {
      const resolved = performance.wins + performance.losses;
      return {
        ...performance,
        winRate: resolved > 0 ? (performance.wins / resolved) * 100 : null,
      };
    })
    .sort((left, right) => left.strategyName.localeCompare(right.strategyName));
}

export function evaluateSignalOutcome(
  record: TrackedSignal,
  candles: Candle[],
  now: number
): { outcome: "ambiguous" | "win" | "loss"; at: number } | null {
  const intervalMatch = /^(\d+)(min|h|day|week|month)$/.exec(record.candleInterval);
  if (!intervalMatch) {
    throw new Error("Cannot evaluate signal outcome for an unsupported candle interval.");
  }
  const amount = Number(intervalMatch[1]);
  const unit = intervalMatch[2];
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Cannot evaluate signal outcome for an invalid candle interval.");
  }

  const completeCandles = candles
    .filter((candle) => {
      if (candle.timestamp <= record.detectedAt) {
        return false;
      }
      const end =
        unit === "month"
          ? addUtcMonths(candle.timestamp, amount)
          : candle.timestamp + amount * intervalUnitMilliseconds(unit);
      return end <= now;
    })
    .sort((left, right) => left.timestamp - right.timestamp);

  for (const candle of completeCandles) {
    const isBuy = record.signal.direction === "BUY";
    const reachedTakeProfit = isBuy
      ? candle.high >= record.signal.takeProfit
      : candle.low <= record.signal.takeProfit;
    const reachedStopLoss = isBuy
      ? candle.low <= record.signal.stopLoss
      : candle.high >= record.signal.stopLoss;

    if (reachedTakeProfit && reachedStopLoss) {
      return { outcome: "ambiguous", at: candle.timestamp };
    }
    if (reachedTakeProfit) {
      return { outcome: "win", at: candle.timestamp };
    }
    if (reachedStopLoss) {
      return { outcome: "loss", at: candle.timestamp };
    }
  }
  return null;
}

function intervalUnitMilliseconds(unit: string): number {
  switch (unit) {
    case "min":
      return 60_000;
    case "h":
      return 3_600_000;
    case "day":
      return 86_400_000;
    case "week":
      return 604_800_000;
    default:
      throw new Error("Invalid fixed candle interval unit.");
  }
}

function addUtcMonths(timestamp: number, months: number): number {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}
