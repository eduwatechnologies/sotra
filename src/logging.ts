export function safeErrorText(error: unknown, secrets: string[] = []): string {
  let detail = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) {
      detail = detail.split(secret).join("[REDACTED]");
    }
  }
  return detail
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]")
    .replace(/([?&]apikey=)[^&\s]+/gi, "$1[REDACTED]");
}
