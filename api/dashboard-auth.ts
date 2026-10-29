import { timingSafeEqual } from "node:crypto";
import type { FunctionRequest } from "../src/platform/vercel-http-types";

export function isAuthorizedDashboardRequest(
  request: FunctionRequest,
  secret = process.env.DASHBOARD_API_SECRET
): boolean {
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(
    secret &&
      Buffer.byteLength(provided) === Buffer.byteLength(secret) &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  );
}
