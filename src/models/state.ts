import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Signal } from "./domain";

export interface PersistedState {
  paused: boolean;
  sentSignalKeys: string[];
  latestSignal: Signal | null;
}

export interface StateRepository {
  load(): Promise<PersistedState>;
  get(): Promise<PersistedState>;
  hasSent(key: string): Promise<boolean>;
  claimSignal(key: string): Promise<boolean>;
  releaseSignal(key: string): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  recordLatestSignal(signal: Signal): Promise<void>;
  recordSentSignal(key: string): Promise<void>;
  acquireScanLock(): Promise<boolean>;
  releaseScanLock(): Promise<void>;
}

const DEFAULT_STATE: PersistedState = {
  paused: false,
  sentSignalKeys: [],
  latestSignal: null,
};

function isSignal(value: unknown): value is Signal {
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

function parseState(value: unknown): PersistedState {
  if (value === null || typeof value !== "object") {
    throw new Error("State file is malformed.");
  }
  const data = value as Record<string, unknown>;
  if (
    typeof data.paused !== "boolean" ||
    !Array.isArray(data.sentSignalKeys) ||
    !data.sentSignalKeys.every((key) => typeof key === "string") ||
    !(data.latestSignal === null || isSignal(data.latestSignal))
  ) {
    throw new Error("State file is malformed.");
  }
  return {
    paused: data.paused,
    sentSignalKeys: [...data.sentSignalKeys],
    latestSignal: data.latestSignal,
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

  async recordLatestSignal(signal: Signal): Promise<void> {
    await this.update((current) => ({ ...current, latestSignal: signal }));
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
