import type { AppConfig } from "../config";
import { fetchCandles } from "./market-data";
import { analyzeCandles } from "./strategy";
import { signalKey, type StateRepository } from "../models/state";
import type { Signal } from "../models/domain";

export interface ScanResult {
  symbol: string;
  status: "signal" | "no signal" | "duplicate" | "paused" | "error";
  signal?: Signal;
  sent?: boolean;
  error?: string;
}

export interface ScannerDependencies {
  fetchCandles: typeof fetchCandles;
  publish: (signal: Signal) => Promise<void>;
  logError: (message: string, error: unknown) => void;
  now?: () => number;
}

export interface ScanOptions {
  publishAlerts: boolean;
  scheduled: boolean;
}

export class SignalScanner {
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly state: StateRepository,
    private readonly dependencies: ScannerDependencies
  ) {}

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    if (this.running) {
      throw new Error("A market scan is already running.");
    }
    if (!(await this.state.acquireScanLock())) {
      throw new Error("A market scan is already running.");
    }
    this.running = true;
    console.info(`Market scan started (${options.scheduled ? "scheduled" : "manual"}).`);

    try {
      const results: ScanResult[] = [];
      for (const symbol of this.config.symbols) {
        if (options.scheduled && (await this.state.get()).paused) {
          results.push({ symbol, status: "paused" });
          continue;
        }
        try {
          const candles = await this.dependencies.fetchCandles(
            symbol,
            this.config.interval,
            this.config.twelveDataApiKey
          );
          const signal = analyzeCandles(candles, symbol, this.config, this.dependencies.now?.());
          if (!signal) {
            const latestCompleted = candles.length > 1 ? candles[candles.length - 2] : undefined;
            if (
              latestCompleted &&
              (latestCompleted.timestamp > (this.dependencies.now?.() ?? Date.now()) ||
                (this.dependencies.now?.() ?? Date.now()) - latestCompleted.timestamp >
                  this.config.maxCandleAgeMinutes * 60_000)
            ) {
              console.warn(`Skipping stale or future candle data for ${symbol}.`);
            }
            results.push({ symbol, status: "no signal" });
            continue;
          }

          await this.state.recordLatestSignal(signal);
          const key = signalKey(signal);
          if (await this.state.hasSent(key)) {
            results.push({ symbol, status: "duplicate", signal });
            continue;
          }
          if (!options.publishAlerts || (await this.state.get()).paused) {
            results.push({ symbol, status: "signal", signal, sent: false });
            continue;
          }

          if (!(await this.state.claimSignal(key))) {
            results.push({ symbol, status: "duplicate", signal });
            continue;
          }
          try {
            await this.dependencies.publish(signal);
            await this.state.recordSentSignal(key);
          } catch (error) {
            await this.state.releaseSignal(key);
            throw error;
          }
          results.push({ symbol, status: "signal", signal, sent: true });
          console.info(`Signal delivered for ${symbol} (${signal.direction}).`);
        } catch (error) {
          this.dependencies.logError(`Scan failed for ${symbol}.`, error);
          results.push({
            symbol,
            status: "error",
            error: error instanceof Error ? error.message : "Unexpected scan error.",
          });
        }
      }
      return results;
    } finally {
      this.running = false;
      await this.state.releaseScanLock();
      console.info("Market scan finished.");
    }
  }
}
