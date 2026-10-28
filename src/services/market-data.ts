import type { Candle } from "../models/domain";
import { safeErrorText } from "../logging";

const API_URL = "https://api.twelvedata.com/time_series";
const REQUEST_TIMEOUT_MS = 15_000;

interface TwelveDataResponse {
  status?: string;
  message?: string;
  values?: unknown;
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Market data contains an invalid candle timestamp.");
  }
  const timestamp = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Market data contains an invalid candle timestamp.");
  }
  return timestamp;
}

function parsePrice(value: unknown, field: string): number {
  const price = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Market data contains an invalid ${field} price.`);
  }
  return price;
}

export function parseTwelveDataResponse(payload: unknown): Candle[] {
  if (payload === null || typeof payload !== "object") {
    throw new Error("Market data response is malformed.");
  }

  const response = payload as TwelveDataResponse;
  if (response.status === "error") {
    throw new Error(`Market data provider error: ${response.message || "unspecified provider error"}`);
  }
  if (!Array.isArray(response.values) || response.values.length === 0) {
    throw new Error("Market data response contains no candle values.");
  }

  const candles = response.values.map((raw): Candle => {
    if (raw === null || typeof raw !== "object") {
      throw new Error("Market data response contains a malformed candle.");
    }

    const value = raw as Record<string, unknown>;
    const candle: Candle = {
      timestamp: parseTimestamp(value.datetime),
      open: parsePrice(value.open, "open"),
      high: parsePrice(value.high, "high"),
      low: parsePrice(value.low, "low"),
      close: parsePrice(value.close, "close"),
    };
    if (
      candle.high < Math.max(candle.open, candle.close, candle.low) ||
      candle.low > Math.min(candle.open, candle.close, candle.high)
    ) {
      throw new Error("Market data response contains inconsistent OHLC values.");
    }
    return candle;
  });

  candles.sort((left, right) => left.timestamp - right.timestamp);
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index - 1].timestamp === candles[index].timestamp) {
      throw new Error("Market data response contains duplicate candle timestamps.");
    }
  }
  return candles;
}

export async function fetchCandles(
  symbol: string,
  interval: string,
  apiKey: string
): Promise<Candle[]> {
  const url = new URL(API_URL);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", "500");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("apikey", apiKey);

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Market data request timed out for ${symbol}.`);
    }
    throw new Error(`Market data request failed for ${symbol}: ${safeErrorText(error, [apiKey])}`);
  }

  if (!response.ok) {
    throw new Error(`Market data provider returned HTTP ${response.status} for ${symbol}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Market data provider returned invalid JSON for ${symbol}.`);
  }
  try {
    return parseTwelveDataResponse(payload);
  } catch (error) {
    throw new Error(safeErrorText(error, [apiKey]));
  }
}
