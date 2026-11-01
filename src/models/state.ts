import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSignal, type Signal } from "./domain";
import {
  isDashboardSettings,
  type DashboardSettings,
} from "../dashboard-settings";
import {
  isStrategyProfileList,
  type StrategyProfile,
} from "../strategy-profiles";
import {
  isTrackedSignal,
  strategyPerformance,
  type SignalDeliveryStatus,
  type SignalOutcome,
  type StrategyPerformance,
  type TrackedSignal,
} from "./signal-history";

export { isSignal } from "./domain";

export interface PersistedState {
  paused: boolean;
  sentSignalKeys: string[];
  latestSignal: Signal | null;
  dashboardSettings: DashboardSettings | null;
  strategyProfiles: StrategyProfile[];
  activeStrategyProfileId: string | null;
  signalHistory: TrackedSignal[];
}

function cloneTrackedSignal(record: TrackedSignal): TrackedSignal {
  return {
    ...record,
    signal: { ...record.signal },
    strategy: {
      ...record.strategy,
      parameters: { ...record.strategy.parameters },
    },
  };
}

export interface StateRepository {
  load(): Promise<PersistedState>;
  get(): Promise<PersistedState>;
  hasSent(key: string): Promise<boolean>;
  claimSignal(key: string): Promise<boolean>;
  releaseSignal(key: string): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  setDashboardSettings(settings: DashboardSettings | null): Promise<void>;
  setStrategyProfiles(
    profiles: StrategyProfile[],
    activeProfileId: string | null
  ): Promise<void>;
  recordLatestSignal(signal: Signal): Promise<void>;
  recordSentSignal(key: string): Promise<void>;
  acquireScanLock(): Promise<boolean>;
  releaseScanLock(): Promise<void>;
}

const DEFAULT_STATE: PersistedState = {
  paused: false,
  sentSignalKeys: [],
  latestSignal: null,
  dashboardSettings: null,
  strategyProfiles: [],
  activeStrategyProfileId: null,
  signalHistory: [],
};

function parseState(value: unknown): PersistedState {
  if (value === null || typeof value !== "object") {
    throw new Error("State file is malformed.");
  }
  const data = value as Record<string, unknown>;
  if (
    typeof data.paused !== "boolean" ||
    !Array.isArray(data.sentSignalKeys) ||
    !data.sentSignalKeys.every((key) => typeof key === "string") ||
    !(data.latestSignal === null || isSignal(data.latestSignal)) ||
    !(
      data.dashboardSettings === undefined ||
      data.dashboardSettings === null ||
      isDashboardSettings(data.dashboardSettings)
    ) ||
    !(
      data.signalHistory === undefined ||
      (Array.isArray(data.signalHistory) && data.signalHistory.every(isTrackedSignal))
    ) ||
    !(
      data.strategyProfiles === undefined ||
      isStrategyProfileList(data.strategyProfiles)
    ) ||
    !(
      data.activeStrategyProfileId === undefined ||
      data.activeStrategyProfileId === null ||
      (typeof data.activeStrategyProfileId === "string" &&
        Array.isArray(data.strategyProfiles) &&
        data.strategyProfiles.some(
          (profile) =>
            isStrategyProfileList(data.strategyProfiles) &&
            profile.id === data.activeStrategyProfileId
        ))
    )
  ) {
    throw new Error("State file is malformed.");
  }
  return {
    paused: data.paused,
    sentSignalKeys: [...data.sentSignalKeys],
    latestSignal: data.latestSignal,
    dashboardSettings: isDashboardSettings(data.dashboardSettings)
      ? { ...data.dashboardSettings, symbols: [...data.dashboardSettings.symbols] }
      : null,
    strategyProfiles: isStrategyProfileList(data.strategyProfiles)
      ? data.strategyProfiles.map((profile) => ({ ...profile }))
      : [],
    activeStrategyProfileId:
      typeof data.activeStrategyProfileId === "string"
        ? data.activeStrategyProfileId
        : null,
    signalHistory:
      Array.isArray(data.signalHistory) && data.signalHistory.every(isTrackedSignal)
        ? data.signalHistory
        : [],
  };
}

export function signalKey(signal: Signal): string {
  return JSON.stringify([signal.symbol, signal.direction, signal.timestamp]);
}

export class StateStore {
  private data: PersistedState = { ...DEFAULT_STATE };
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly claimedSignalKeys = new Set<string>();
  private scanLocked = false;

  constructor(
    private readonly filePath: string,
    private readonly maxSignalKeys: number
  ) {
    if (!Number.isInteger(maxSignalKeys) || maxSignalKeys <= 0) {
      throw new Error("Maximum stored signal keys must be a positive integer.");
    }
  }

  async load(): Promise<PersistedState> {
    try {
      this.data = parseState(JSON.parse(await readFile(this.filePath, "utf8")) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.data = { ...DEFAULT_STATE };
        await this.persist(this.data);
      } else {
        throw error;
      }
    }
    return this.get();
  }

  async get(): Promise<PersistedState> {
    return {
      paused: this.data.paused,
      sentSignalKeys: [...this.data.sentSignalKeys],
      latestSignal: this.data.latestSignal ? { ...this.data.latestSignal } : null,
      dashboardSettings: this.data.dashboardSettings
        ? {
            ...this.data.dashboardSettings,
            symbols: [...this.data.dashboardSettings.symbols],
          }
        : null,
      strategyProfiles: this.data.strategyProfiles.map((profile) => ({ ...profile })),
      activeStrategyProfileId: this.data.activeStrategyProfileId,
      signalHistory: this.data.signalHistory.map(cloneTrackedSignal),
    };
  }

  async hasSent(key: string): Promise<boolean> {
    return this.data.sentSignalKeys.includes(key);
  }

  async claimSignal(key: string): Promise<boolean> {
    if ((await this.hasSent(key)) || this.claimedSignalKeys.has(key)) {
      return false;
    }
    this.claimedSignalKeys.add(key);
    return true;
  }

  async releaseSignal(key: string): Promise<void> {
    this.claimedSignalKeys.delete(key);
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.update((current) => ({ ...current, paused }));
  }

  async setDashboardSettings(settings: DashboardSettings | null): Promise<void> {
    if (settings !== null && !isDashboardSettings(settings)) {
      throw new Error("Dashboard settings are invalid.");
    }
    await this.update((current) => ({
      ...current,
      dashboardSettings: settings
        ? { ...settings, symbols: [...settings.symbols] }
        : null,
    }));
  }

  async setStrategyProfiles(
    profiles: StrategyProfile[],
    activeProfileId: string | null
  ): Promise<void> {
    if (
      !isStrategyProfileList(profiles) ||
      (activeProfileId !== null && !profiles.some(({ id }) => id === activeProfileId))
    ) {
      throw new Error("Strategy profiles or active profile are invalid.");
    }
    await this.update((current) => ({
      ...current,
      strategyProfiles: profiles.map((profile) => ({ ...profile })),
      activeStrategyProfileId: activeProfileId,
    }));
  }

  async recordLatestSignal(signal: Signal): Promise<void> {
    await this.update((current) => ({ ...current, latestSignal: signal }));
  }

  async recordDetectedSignal(record: TrackedSignal): Promise<TrackedSignal> {
    if (!isTrackedSignal(record)) {
      throw new Error("Signal history record is invalid.");
    }
    let stored!: TrackedSignal;
    await this.update((current) => {
      const existing = current.signalHistory.find(({ key }) => key === record.key);
      stored = cloneTrackedSignal(existing ?? record);
      return existing
        ? current
        : { ...current, signalHistory: [...current.signalHistory, cloneTrackedSignal(record)] };
    });
    return stored;
  }

  async getSignal(key: string): Promise<TrackedSignal | null> {
    const record = this.data.signalHistory.find((item) => item.key === key);
    return record ? cloneTrackedSignal(record) : null;
  }

  async updateDeliveryStatus(key: string, status: SignalDeliveryStatus): Promise<void> {
    await this.update((current) => ({
      ...current,
      signalHistory: current.signalHistory.map((record) =>
        record.key === key && record.deliveryStatus !== "succeeded"
          ? { ...record, deliveryStatus: status }
          : record
      ),
    }));
  }

  async getUnresolvedSignals(symbol: string): Promise<TrackedSignal[]> {
    return this.data.signalHistory
      .filter((record) => record.signal.symbol === symbol && record.outcome === "unresolved")
      .map(cloneTrackedSignal);
  }

  async setSignalOutcome(
    key: string,
    outcome: "ambiguous" | "win" | "loss",
    at: number
  ): Promise<void> {
    await this.update((current) => ({
      ...current,
      signalHistory: current.signalHistory.map((record) =>
        record.key === key && record.outcome === "unresolved"
          ? { ...record, outcome, outcomeAt: at }
          : record
      ),
    }));
  }

  async getStrategyPerformance(): Promise<StrategyPerformance[]> {
    return strategyPerformance(this.data.signalHistory);
  }

  async getRecentSignals(limit: number): Promise<TrackedSignal[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Signal history limit must be an integer between 1 and 100.");
    }
    return this.data.signalHistory
      .slice()
      .sort((left, right) => right.detectedAt - left.detectedAt)
      .slice(0, limit)
      .map(cloneTrackedSignal);
  }

  async recordSentSignal(key: string): Promise<void> {
    await this.update((current) => ({
      ...current,
      sentSignalKeys: [
        ...current.sentSignalKeys.filter((item) => item !== key),
        key,
      ].slice(-this.maxSignalKeys),
    }));
    this.claimedSignalKeys.delete(key);
  }

  async acquireScanLock(): Promise<boolean> {
    if (this.scanLocked) {
      return false;
    }
    this.scanLocked = true;
    return true;
  }

  async releaseScanLock(): Promise<void> {
    this.scanLocked = false;
  }

  private async update(createNext: (current: PersistedState) => PersistedState): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const next = createNext(this.data);
      await this.persist(next);
      this.data = next;
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private async persist(next: PersistedState): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (!(cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT")) {
          throw cleanupError;
        }
      }
      throw error;
    }
  }
}
