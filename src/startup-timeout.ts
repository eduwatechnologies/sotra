export async function withStartupTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  description = "Startup"
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout();
      reject(new Error(`${description} timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
