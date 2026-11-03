import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { isSignal } from "./domain";
import {
  type SignalDeliveryStatus,
  type SignalHistoryRepository,
  type SignalOutcome,
  type StrategyPerformance,
  type StrategySnapshot,
  type TrackedSignal,
} from "./signal-history";
import { isStrategyParameters } from "../strategy-profiles";

const CREATE_SIGNAL_HISTORY_TABLE = `
CREATE TABLE IF NOT EXISTS sotra_signal_history (
  signal_key TEXT PRIMARY KEY,
  signal_id UUID NOT NULL UNIQUE,
  signal JSONB NOT NULL,
  strategy_snapshot JSONB NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  candle_interval TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (
    delivery_status IN ('not_attempted', 'attempting', 'succeeded', 'failed')
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('unresolved', 'ambiguous', 'win', 'loss')),
  outcome_at TIMESTAMPTZ
)`;

const CREATE_SIGNAL_HISTORY_INDEX = `
CREATE INDEX IF NOT EXISTS sotra_signal_history_symbol_outcome_idx
ON sotra_signal_history ((signal->>'symbol'), outcome, detected_at DESC)`;

const ADD_CANDLE_INTERVAL_COLUMN = `
ALTER TABLE sotra_signal_history
ADD COLUMN IF NOT EXISTS candle_interval TEXT NOT NULL DEFAULT '5min'`;

const LEGACY_SSL_MODES = new Set(["prefer", "require", "verify-ca"]);

export function normalizePostgresSslMode(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (sslMode && LEGACY_SSL_MODES.has(sslMode)) {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

function parseTrackedSignal(row: Record<string, unknown>): TrackedSignal {
  const signal = parseJson(row.signal);
  const strategy = parseJson(row.strategy_snapshot);
  const deliveryStatus = row.delivery_status;
  const outcome = row.outcome;
  const detectedAt = new Date(String(row.detected_at)).getTime();
  const candleInterval = row.candle_interval;
  const outcomeAt = row.outcome_at === null
    ? null
    : new Date(String(row.outcome_at)).getTime();

  if (
    typeof row.signal_key !== "string" ||
    typeof row.signal_id !== "string" ||
    typeof candleInterval !== "string" ||
    !isSignal(signal) ||
    strategy === null ||
    typeof strategy !== "object" ||
    typeof (strategy as Record<string, unknown>).id !== "string" ||
    typeof (strategy as Record<string, unknown>).name !== "string" ||
    !isStrategyParameters((strategy as Record<string, unknown>).parameters) ||
    !["not_attempted", "attempting", "succeeded", "failed"].includes(
      String(deliveryStatus)
    ) ||
    !["unresolved", "ambiguous", "win", "loss"].includes(String(outcome)) ||
    !Number.isFinite(detectedAt) ||
    !(outcomeAt === null || Number.isFinite(outcomeAt))
  ) {
    throw new Error("Stored signal history row is malformed.");
  }
  return {
    id: row.signal_id,
    key: row.signal_key,
    signal,
    strategy: strategy as StrategySnapshot,
    detectedAt,
    candleInterval,
    deliveryStatus: deliveryStatus as SignalDeliveryStatus,
    outcome: outcome as SignalOutcome,
    outcomeAt,
  };
}

export class PostgresSignalHistoryStore implements SignalHistoryRepository {
  private constructor(private readonly pool: Pool) {}

  static fromEnv(env: NodeJS.ProcessEnv): PostgresSignalHistoryStore {
    const connectionString = env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for PostgreSQL signal history.");
    }
    return new PostgresSignalHistoryStore(
      new Pool({
        connectionString: normalizePostgresSslMode(connectionString),
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
        allowExitOnIdle: true,
      })
    );
  }

  async initialize(): Promise<void> {
    await this.pool.query(CREATE_SIGNAL_HISTORY_TABLE);
    await this.pool.query(ADD_CANDLE_INTERVAL_COLUMN);
    await this.pool.query(CREATE_SIGNAL_HISTORY_INDEX);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async recordDetectedSignal(record: TrackedSignal): Promise<TrackedSignal> {
    const id = record.id || randomUUID();
    await this.pool.query(
      `INSERT INTO sotra_signal_history
        (signal_key, signal_id, signal, strategy_snapshot, detected_at, candle_interval,
         delivery_status, outcome, outcome_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, to_timestamp($5 / 1000.0), $6, $7, $8, NULL)
       ON CONFLICT (signal_key) DO NOTHING`,
      [
        record.key,
        id,
        JSON.stringify(record.signal),
        JSON.stringify(record.strategy),
        record.detectedAt,
        record.candleInterval,
        record.deliveryStatus,
        record.outcome,
      ]
    );
    const stored = await this.getSignal(record.key);
    if (!stored) {
      throw new Error("Signal history insert completed without a stored record.");
    }
    return stored;
  }

  async getSignal(key: string): Promise<TrackedSignal | null> {
    const result = await this.pool.query(
      `SELECT signal_key, signal_id, signal, strategy_snapshot, detected_at,
              candle_interval,
              delivery_status, outcome, outcome_at
       FROM sotra_signal_history WHERE signal_key = $1`,
      [key]
    );
    return result.rows[0] ? parseTrackedSignal(result.rows[0]) : null;
  }

  async updateDeliveryStatus(key: string, status: SignalDeliveryStatus): Promise<void> {
    await this.pool.query(
      `UPDATE sotra_signal_history
       SET delivery_status = CASE
         WHEN delivery_status = 'succeeded' THEN 'succeeded'
         ELSE $2
       END
       WHERE signal_key = $1`,
      [key, status]
    );
  }

  async getUnresolvedSignals(symbol: string): Promise<TrackedSignal[]> {
    const result = await this.pool.query(
      `SELECT signal_key, signal_id, signal, strategy_snapshot, detected_at,
              candle_interval,
              delivery_status, outcome, outcome_at
       FROM sotra_signal_history
       WHERE signal->>'symbol' = $1 AND outcome = 'unresolved'
       ORDER BY detected_at ASC`,
      [symbol]
    );
    return result.rows.map(parseTrackedSignal);
  }

  async setSignalOutcome(
    key: string,
    outcome: "ambiguous" | "win" | "loss",
    at: number
  ): Promise<void> {
    await this.pool.query(
      `UPDATE sotra_signal_history
       SET outcome = $2, outcome_at = to_timestamp($3 / 1000.0)
       WHERE signal_key = $1 AND outcome = 'unresolved'`,
      [key, outcome, at]
    );
  }

  async getStrategyPerformance(): Promise<StrategyPerformance[]> {
    const result = await this.pool.query(
      `SELECT strategy_snapshot->>'id' AS strategy_id,
              strategy_snapshot->>'name' AS strategy_name,
              count(*)::int AS total,
              count(*) FILTER (WHERE outcome = 'win')::int AS wins,
              count(*) FILTER (WHERE outcome = 'loss')::int AS losses,
              count(*) FILTER (
                WHERE outcome IN ('unresolved', 'ambiguous')
              )::int AS unresolved
       FROM sotra_signal_history
       GROUP BY strategy_snapshot->>'id', strategy_snapshot->>'name'
       ORDER BY strategy_snapshot->>'name'`
    );
    return result.rows.map((row) => {
      const { strategy_id: strategyId, strategy_name: strategyName } = row;
      const total = Number(row.total);
      const wins = Number(row.wins);
      const losses = Number(row.losses);
      const unresolved = Number(row.unresolved);
      if (
        typeof strategyId !== "string" ||
        typeof strategyName !== "string" ||
        ![total, wins, losses, unresolved].every(Number.isSafeInteger)
      ) {
        throw new Error("Stored strategy performance row is malformed.");
      }
      const resolved = wins + losses;
      return {
        strategyId,
        strategyName,
        total,
        wins,
        losses,
        unresolved,
        winRate: resolved > 0 ? (wins / resolved) * 100 : null,
      };
    });
  }

  async getRecentSignals(limit: number): Promise<TrackedSignal[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Signal history limit must be an integer between 1 and 100.");
    }
    const result = await this.pool.query(
      `SELECT signal_key, signal_id, signal, strategy_snapshot, detected_at,
              candle_interval,
              delivery_status, outcome, outcome_at
       FROM sotra_signal_history
       ORDER BY detected_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(parseTrackedSignal);
  }
}
