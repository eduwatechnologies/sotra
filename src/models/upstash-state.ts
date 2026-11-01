import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { Signal } from "./domain";
import {
  isDashboardSettings,
  type DashboardSettings,
} from "../dashboard-settings";
import {
  isStrategyProfileList,
  type StrategyProfile,
} from "../strategy-profiles";
import {
  isSignal,
  type PersistedState,
  type StateRepository,
} from "./state";

const CLAIM_SIGNAL_SCRIPT = `
if redis.call("ZSCORE", KEYS[1], ARGV[1]) then
  return 0
end
if redis.call("SET", KEYS[2], ARGV[2], "NX", "EX", ARGV[3]) then
  return 1
end
return 0
`;

const RECORD_SENT_SCRIPT = `
if redis.call("GET", KEYS[2]) ~= ARGV[1] then
  return 0
end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[3])
local count = redis.call("ZCARD", KEYS[1])
local maximum = tonumber(ARGV[4])
if count > maximum then
  redis.call("ZREMRANGEBYRANK", KEYS[1], 0, count - maximum - 1)
end
redis.call("DEL", KEYS[2])
return 1
`;

const RELEASE_SIGNAL_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const RELEASE_SCAN_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const SCAN_LOCK_TTL_SECONDS = 300;
const SIGNAL_CLAIM_TTL_SECONDS = 300;

export function parseLatestSignal(value: unknown): Signal | null {
  if (value === null || value === undefined) {
    return null;
  }

  const signal = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!isSignal(signal)) {
    throw new Error("Stored latest signal is malformed.");
  }
  return signal;
}

function parseDashboardSettings(value: unknown): DashboardSettings | null {
  if (value === null || value === undefined) {
    return null;
  }
  const settings = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!isDashboardSettings(settings)) {
    throw new Error("Stored dashboard settings are malformed.");
  }
  return settings;
}

interface StoredStrategyProfiles {
  profiles: StrategyProfile[];
  activeProfileId: string | null;
}

function parseStrategyProfiles(value: unknown): StoredStrategyProfiles {
  if (value === null || value === undefined) {
    return { profiles: [], activeProfileId: null };
  }
  const stored = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (stored === null || typeof stored !== "object") {
    throw new Error("Stored strategy profiles are malformed.");
  }
  const data = stored as Record<string, unknown>;
  if (
    !isStrategyProfileList(data.profiles) ||
    !(
      data.activeProfileId === null ||
      (typeof data.activeProfileId === "string" &&
        data.profiles.some(({ id }) => id === data.activeProfileId))
    )
  ) {
    throw new Error("Stored strategy profiles are malformed.");
  }
  return {
    profiles: data.profiles.map((profile) => ({ ...profile })),
    activeProfileId: data.activeProfileId,
  };
}

export class UpstashStateStore implements StateRepository {
  private readonly signalClaims = new Map<string, string>();
  private readonly claimSignalScript;
  private readonly recordSentScript;
  private readonly releaseSignalScript;
  private readonly releaseScanScript;
  private scanLockToken: string | undefined;

  constructor(
    private readonly redis: Redis,
    private readonly maxSignalKeys: number,
    private readonly namespace = "sotra"
  ) {
    if (!Number.isInteger(maxSignalKeys) || maxSignalKeys <= 0) {
      throw new Error("Maximum stored signal keys must be a positive integer.");
    }
    this.claimSignalScript = redis.createScript<number>(CLAIM_SIGNAL_SCRIPT);
    this.recordSentScript = redis.createScript<number>(RECORD_SENT_SCRIPT);
    this.releaseSignalScript = redis.createScript<number>(RELEASE_SIGNAL_SCRIPT);
    this.releaseScanScript = redis.createScript<number>(RELEASE_SCAN_SCRIPT);
  }

  static fromEnv(
    env: NodeJS.ProcessEnv,
    maxSignalKeys: number
  ): UpstashStateStore {
    const url = env.UPSTASH_REDIS_REST_URL?.trim();
    const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for Vercel state storage."
      );
    }
    const deployment = env.VERCEL_ENV?.trim() || "local";
    const namespace = env.UPSTASH_STATE_PREFIX?.trim() || `sotra:${deployment}`;
    return new UpstashStateStore(new Redis({ url, token }), maxSignalKeys, namespace);
  }

  async load(): Promise<PersistedState> {
    return this.get();
  }

  async get(): Promise<PersistedState> {
    const [paused, latestSignal, sentSignalKeys, dashboardSettings, strategies] = await Promise.all([
      this.redis.get<string>(this.key("paused")),
      this.redis.get<unknown>(this.key("latest-signal")),
      this.redis.zrange<string[]>(this.key("sent-signals"), 0, -1),
      this.redis.get<unknown>(this.key("dashboard-settings")),
      this.redis.get<unknown>(this.key("strategy-profiles")),
    ]);

    const strategyConfiguration = parseStrategyProfiles(strategies);
    return {
      paused: paused === "1",
      latestSignal: parseLatestSignal(latestSignal),
      sentSignalKeys,
      dashboardSettings: parseDashboardSettings(dashboardSettings),
      strategyProfiles: strategyConfiguration.profiles,
      activeStrategyProfileId: strategyConfiguration.activeProfileId,
      signalHistory: [],
    };
  }

  async hasSent(key: string): Promise<boolean> {
    return (await this.redis.zscore(this.key("sent-signals"), key)) !== null;
  }

  async claimSignal(key: string): Promise<boolean> {
    const token = randomUUID();
    const result = await this.claimSignalScript.eval(
      [this.key("sent-signals"), this.signalClaimKey(key)],
      [key, token, String(SIGNAL_CLAIM_TTL_SECONDS)]
    );
    if (result !== 1) {
      return false;
    }
    this.signalClaims.set(key, token);
    return true;
  }

  async releaseSignal(key: string): Promise<void> {
    const token = this.signalClaims.get(key);
    if (!token) {
      return;
    }
    this.signalClaims.delete(key);
    await this.releaseSignalScript.eval([this.signalClaimKey(key)], [token]);
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.redis.set(this.key("paused"), paused ? "1" : "0");
  }

  async setDashboardSettings(settings: DashboardSettings | null): Promise<void> {
    if (settings !== null && !isDashboardSettings(settings)) {
      throw new Error("Dashboard settings are invalid.");
    }
    if (settings === null) {
      await this.redis.del(this.key("dashboard-settings"));
      return;
    }
    await this.redis.set(this.key("dashboard-settings"), JSON.stringify(settings));
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
    await this.redis.set(
      this.key("strategy-profiles"),
      JSON.stringify({ profiles, activeProfileId })
    );
  }

  async recordLatestSignal(signal: Signal): Promise<void> {
    await this.redis.set(this.key("latest-signal"), JSON.stringify(signal));
  }

  async recordSentSignal(key: string): Promise<void> {
    const token = this.signalClaims.get(key);
    if (!token) {
      throw new Error("Signal delivery was not claimed before recording.");
    }
    const result = await this.recordSentScript.eval(
      [this.key("sent-signals"), this.signalClaimKey(key)],
      [token, String(Date.now()), key, String(this.maxSignalKeys)]
    );
    this.signalClaims.delete(key);
    if (result !== 1) {
      throw new Error("Signal delivery claim expired before it could be recorded.");
    }
  }

  async acquireScanLock(): Promise<boolean> {
    if (this.scanLockToken) {
      return false;
    }
    const token = randomUUID();
    const result = await this.redis.set(this.key("scan-lock"), token, {
      nx: true,
      ex: SCAN_LOCK_TTL_SECONDS,
    });
    if (result !== "OK") {
      return false;
    }
    this.scanLockToken = token;
    return true;
  }

  async releaseScanLock(): Promise<void> {
    const token = this.scanLockToken;
    if (!token) {
      return;
    }
    this.scanLockToken = undefined;
    await this.releaseScanScript.eval([this.key("scan-lock")], [token]);
  }

  private signalClaimKey(key: string): string {
    return `${this.key("signal-claim")}:${Buffer.from(key).toString("base64url")}`;
  }

  private key(suffix: string): string {
    return `${this.namespace}:${suffix}`;
  }
}
