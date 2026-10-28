import "dotenv/config";
import { createRuntime, type ApplicationRuntime } from "./app";

let runtimePromise: Promise<ApplicationRuntime> | undefined;

export function getVercelRuntime(): Promise<ApplicationRuntime> {
  if (!runtimePromise) {
    runtimePromise = createRuntime().catch((error: unknown) => {
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}
