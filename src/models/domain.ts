export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type SignalDirection = "BUY" | "SELL";

export interface Signal {
  symbol: string;
  direction: SignalDirection;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rewardRisk: number;
  timestamp: number;
  rationale: string;
}

export function isSignal(value: unknown): value is Signal {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const signal = value as Record<string, unknown>;
  return (
    typeof signal.symbol === "string" &&
    (signal.direction === "BUY" || signal.direction === "SELL") &&
    ["entry", "stopLoss", "takeProfit", "rewardRisk", "timestamp"].every(
      (key) => typeof signal[key] === "number" && Number.isFinite(signal[key])
    ) &&
    typeof signal.rationale === "string"
  );
}
