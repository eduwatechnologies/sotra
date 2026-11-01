import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config";
import { fetchCandles } from "./market-data";
import { analyzeCandles } from "./strategy";
import { signalKey, type StateRepository } from "../models/state";
import type { Signal } from "../models/domain";
import {
  applyStrategyProfile,
  strategyParametersFromConfig,
} from "../strategy-profiles";
import {
  evaluateSignalOutcome,
  type SignalHistoryRepository,
  type StrategySnapshot,
  type TrackedSignal,
} from "../models/signal-history";

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
  history: SignalHistoryRepository;
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
      const state = await this.state.get();
      const baseConfig = {
        ...this.config,
        ...(state.dashboardSettings ?? {}),
      };
      const config = applyStrategyProfile(
        baseConfig,
        state.strategyProfiles,
        state.activeStrategyProfileId
      );
      const results: ScanResult[] = [];
      for (const symbol of config.symbols) {
        if (options.scheduled && (await this.state.get()).paused) {
          results.push({ symbol, status: "paused" });
          continue;
        }
        try {
          const candles = await this.dependencies.fetchCandles(
            symbol,
            config.interval,
            config.twelveDataApiKey
          );
          const now = this.dependencies.now?.() ?? Date.now();
          const unresolvedSignals = await this.dependencies.history.getUnresolvedSignals(symbol);
          const outcomeCandles = new Map([[config.interval, candles]]);
          for (const previous of unresolvedSignals) {
            let candlesForSignal = outcomeCandles.get(previous.candleInterval);
            if (!candlesForSignal) {
              try {
                candlesForSignal = await this.dependencies.fetchCandles(
                  symbol,
                  previous.candleInterval,
                  config.twelveDataApiKey
                );
                outcomeCandles.set(previous.candleInterval, candlesForSignal);
              } catch (error) {
                this.dependencies.logError(
                  `Outcome evaluation data unavailable for ${symbol} at ${previous.candleInterval}.`,
                  error
                );
                continue;
              }
            }
            const evaluation = evaluateSignalOutcome(previous, candlesForSignal, now);
            if (evaluation) {
              await this.dependencies.history.setSignalOutcome(
                previous.key,
                evaluation.outcome,
                evaluation.at
              );
            }
          }

          const signal = analyzeCandles(candles, symbol, config, now);
          if (!signal) {
            const latestCompleted = candles.length > 1 ? candles[candles.length - 2] : undefined;
            if (
              latestCompleted &&
              (latestCompleted.timestamp > now ||
                now - latestCompleted.timestamp >
                  config.maxCandleAgeMinutes * 60_000)
            ) {
              console.warn(`Skipping stale or future candle data for ${symbol}.`);
            }
            results.push({ symbol, status: "no signal" });
            continue;
          }

          await this.state.recordLatestSignal(signal);
          const key = signalKey(signal);
          const strategy = this.strategySnapshot(
            state.strategyProfiles,
            state.activeStrategyProfileId,
            config
          );
          const trackedSignal: TrackedSignal = await this.dependencies.history.recordDetectedSignal({
            id: randomUUID(),
            key,
            signal,
            strategy,
            detectedAt: now,
            candleInterval: config.interval,
            deliveryStatus: "not_attempted",
            outcome: "unresolved",
            outcomeAt: null,
          });
          const alreadySent = await this.state.hasSent(key);
          if (alreadySent && trackedSignal.deliveryStatus !== "succeeded") {
            await this.dependencies.history.updateDeliveryStatus(key, "succeeded");
          }
          if (alreadySent || trackedSignal.deliveryStatus === "succeeded") {
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
            await this.dependencies.history.updateDeliveryStatus(key, "attempting");
            await this.dependencies.publish(signal);
            await this.dependencies.history.updateDeliveryStatus(key, "succeeded");
            await this.state.recordSentSignal(key);
          } catch (error) {
            try {
              await this.dependencies.history.updateDeliveryStatus(key, "failed");
            } finally {
              await this.state.releaseSignal(key);
            }
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

  private strategySnapshot(
    profiles: Parameters<typeof applyStrategyProfile>[1],
    activeProfileId: string | null,
    config: AppConfig
  ): StrategySnapshot {
    if (activeProfileId === null) {
      return {
        id: "default",
        name: "Default strategy",
        parameters: strategyParametersFromConfig(config),
      };
    }
    const profile = profiles.find(({ id }) => id === activeProfileId);
    if (!profile) {
      throw new Error("Active strategy profile is missing.");
    }
    const { id, name, ...parameters } = profile;
    return { id, name, parameters };
  }
}
