import type { AppConfig } from "./config";

export interface StrategyParameters {
  minRewardRisk: number;
  swingLookback: number;
  structureLookback: number;
  maxBarsSinceSweep: number;
  atrPeriod: number;
  maxRiskAtrMultiple: number;
  maxCandleAgeMinutes: number;
}

export interface StrategyProfile extends StrategyParameters {
  id: string;
  name: string;
}

export const MAX_STRATEGY_PROFILES = 20;

export function isStrategyParameters(value: unknown): value is StrategyParameters {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const parameters = value as Record<string, unknown>;
  return (
    typeof parameters.minRewardRisk === "number" &&
    Number.isFinite(parameters.minRewardRisk) &&
    parameters.minRewardRisk >= 0.1 &&
    parameters.minRewardRisk <= 100 &&
    Number.isInteger(parameters.swingLookback) &&
    Number(parameters.swingLookback) >= 1 &&
    Number(parameters.swingLookback) <= 100 &&
    Number.isInteger(parameters.structureLookback) &&
    Number(parameters.structureLookback) >= 1 &&
    Number(parameters.structureLookback) <= 100 &&
    Number.isInteger(parameters.maxBarsSinceSweep) &&
    Number(parameters.maxBarsSinceSweep) >= 1 &&
    Number(parameters.maxBarsSinceSweep) <= 20 &&
    Number.isInteger(parameters.atrPeriod) &&
    Number(parameters.atrPeriod) >= 1 &&
    Number(parameters.atrPeriod) <= 100 &&
    typeof parameters.maxRiskAtrMultiple === "number" &&
    Number.isFinite(parameters.maxRiskAtrMultiple) &&
    parameters.maxRiskAtrMultiple >= 0.1 &&
    parameters.maxRiskAtrMultiple <= 20 &&
    typeof parameters.maxCandleAgeMinutes === "number" &&
    Number.isFinite(parameters.maxCandleAgeMinutes) &&
    parameters.maxCandleAgeMinutes >= 1 &&
    parameters.maxCandleAgeMinutes <= 1440
  );
}

export function isStrategyProfile(value: unknown): value is StrategyProfile {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === "string" &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(profile.id) &&
    typeof profile.name === "string" &&
    profile.name.trim().length > 0 &&
    profile.name.trim().length <= 40 &&
    isStrategyParameters(profile)
  );
}

export function isStrategyProfileList(value: unknown): value is StrategyProfile[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_STRATEGY_PROFILES &&
    value.every(isStrategyProfile) &&
    new Set(value.map((profile) => profile.id)).size === value.length &&
    new Set(value.map((profile) => profile.name.trim().toLowerCase())).size === value.length
  );
}

export function strategyParametersFromConfig(config: AppConfig): StrategyParameters {
  return {
    minRewardRisk: config.minRewardRisk,
    swingLookback: config.swingLookback,
    structureLookback: config.structureLookback,
    maxBarsSinceSweep: config.maxBarsSinceSweep,
    atrPeriod: config.atrPeriod,
    maxRiskAtrMultiple: config.maxRiskAtrMultiple,
    maxCandleAgeMinutes: config.maxCandleAgeMinutes,
  };
}

export function applyStrategyProfile(
  config: AppConfig,
  profiles: StrategyProfile[],
  activeProfileId: string | null
): AppConfig {
  if (activeProfileId === null) {
    return config;
  }
  const profile = profiles.find(({ id }) => id === activeProfileId);
  if (!profile) {
    throw new Error("Active strategy profile is missing.");
  }
  return { ...config, ...profile };
}
