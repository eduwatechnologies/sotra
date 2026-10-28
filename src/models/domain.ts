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
