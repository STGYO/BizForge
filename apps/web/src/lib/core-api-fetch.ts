interface CoreApiFetchOptions {
  retries?: number;
  retryDelayMs?: number;
}

function getCoreApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_CORE_API_URL ?? "http://localhost:4000";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchCoreApi(
  path: string,
  init?: RequestInit,
  options?: CoreApiFetchOptions
): Promise<Response> {
  const retries = options?.retries ?? 5;
  const retryDelayMs = options?.retryDelayMs ?? 300;
  const targetPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${getCoreApiBaseUrl()}${targetPath}`;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status >= 500 && response.status <= 504 && attempt < retries) {
        await sleep(retryDelayMs);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to connect to core API");
}
