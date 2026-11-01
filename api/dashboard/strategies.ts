import { randomUUID } from "node:crypto";
import { safeErrorText } from "../../src/logging";
import { applyDashboardSettings } from "../../src/dashboard-settings";
import type { FunctionRequest, FunctionResponse } from "../../src/platform/vercel-http-types";
import {
  isStrategyParameters,
  isStrategyProfile,
  isStrategyProfileList,
  MAX_STRATEGY_PROFILES,
  strategyParametersFromConfig,
  type StrategyParameters,
  type StrategyProfile,
} from "../../src/strategy-profiles";
import { getVercelRuntime } from "../../src/vercel-runtime";
import { isAuthorizedDashboardRequest } from "../dashboard-auth";

type DashboardRequest = FunctionRequest & { body?: unknown };

function responseData(
  config: Parameters<typeof strategyParametersFromConfig>[0],
  profiles: StrategyProfile[],
  activeProfileId: string | null
) {
  return {
    defaultParameters: strategyParametersFromConfig(config),
    profiles,
    activeProfileId,
  };
}

export default async function dashboardStrategies(
  request: FunctionRequest,
  response: FunctionResponse
): Promise<void> {
  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!isAuthorizedDashboardRequest(request)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const runtime = await getVercelRuntime();
    const currentState = await runtime.state.get();
    const baseConfig = applyDashboardSettings(
      runtime.config,
      currentState.dashboardSettings
    );

    if (request.method === "GET") {
      response
        .status(200)
        .json(
          responseData(
            baseConfig,
            currentState.strategyProfiles,
            currentState.activeStrategyProfileId
          )
        );
      return;
    }

    const requestBody = (request as DashboardRequest).body;
    if (
      requestBody === null ||
      typeof requestBody !== "object" ||
      !("action" in requestBody)
    ) {
      response.status(400).json({ error: "Expected a strategy profile action" });
      return;
    }
    const body = requestBody as Record<string, unknown>;

    let profiles = currentState.strategyProfiles;
    let activeProfileId = currentState.activeStrategyProfileId;
    if (body.action === "create") {
      const name = body.name;
      const parameters = body.parameters;
      if (
        Object.keys(body).length !== 3 ||
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 40 ||
        !isStrategyParameters(parameters)
      ) {
        response.status(400).json({ error: "Expected a name and valid strategy parameters" });
        return;
      }
      if (profiles.length >= MAX_STRATEGY_PROFILES) {
        response.status(400).json({ error: "Maximum number of strategy profiles reached" });
        return;
      }
      const profile: StrategyProfile = {
        id: randomUUID(),
        name: name.trim(),
        ...({
          minRewardRisk: parameters.minRewardRisk,
          swingLookback: parameters.swingLookback,
          structureLookback: parameters.structureLookback,
          maxBarsSinceSweep: parameters.maxBarsSinceSweep,
          atrPeriod: parameters.atrPeriod,
          maxRiskAtrMultiple: parameters.maxRiskAtrMultiple,
          maxCandleAgeMinutes: parameters.maxCandleAgeMinutes,
        } satisfies StrategyParameters),
      };
      profiles = [...profiles, profile];
      if (!isStrategyProfile(profile) || !isStrategyProfileList(profiles)) {
        response.status(400).json({ error: "Strategy profile name must be unique" });
        return;
      }
    } else if (body.action === "activate") {
      const profileId = body.profileId;
      if (
        Object.keys(body).length !== 2 ||
        !(profileId === null || typeof profileId === "string") ||
        (profileId !== null && !profiles.some(({ id }) => id === profileId))
      ) {
        response.status(400).json({ error: "Selected strategy profile does not exist" });
        return;
      }
      activeProfileId = profileId;
    } else if (body.action === "delete") {
      const profileId = body.profileId;
      if (Object.keys(body).length !== 2 || typeof profileId !== "string") {
        response.status(400).json({ error: "Expected a strategy profile ID" });
        return;
      }
      if (!profiles.some(({ id }) => id === profileId)) {
        response.status(404).json({ error: "Strategy profile not found" });
        return;
      }
      if (activeProfileId === profileId) {
        response.status(409).json({
          error: "Activate another profile or the default before deleting this profile",
        });
        return;
      }
      profiles = profiles.filter(({ id }) => id !== profileId);
    } else {
      response.status(400).json({ error: "Unsupported strategy profile action" });
      return;
    }

    await runtime.state.setStrategyProfiles(profiles, activeProfileId);
    response
      .status(200)
      .json(responseData(baseConfig, profiles, activeProfileId));
  } catch (error) {
    console.error(
      `Dashboard strategy request failed. ${safeErrorText(error, [
        process.env.TELEGRAM_BOT_TOKEN ?? "",
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
        process.env.DASHBOARD_API_SECRET ?? "",
      ])}`
    );
    response.status(500).json({ error: "Strategy profiles are unavailable" });
  }
}
