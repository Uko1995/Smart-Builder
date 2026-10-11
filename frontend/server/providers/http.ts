/** Timeouts, bounded retries and backoff for documented provider APIs. */

const SECRET_PARAMS = /([?&](?:apiKey|api_key|key|token)=)[^&]+/gi;

export function redact(text: string): string {
  return text.replace(SECRET_PARAMS, "$1***");
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public statusCode: number | null = null,
    public retryable = false,
  ) {
    super(redact(message));
  }
}

export type HttpResponse = { status: number; payload: unknown; headers: Headers; text: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function providerGet(
  url: string,
  options: { headers?: Record<string, string>; params?: Record<string, string>; timeoutMs?: number; maxRetries?: number; json?: boolean } = {},
): Promise<HttpResponse> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(options.params ?? {})) target.searchParams.set(key, value);
  const maxRetries = options.maxRetries ?? 3;
  let lastError: ProviderRequestError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(target, {
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        cache: "no-store",
        redirect: "follow",
      });
    } catch (error) {
      lastError = new ProviderRequestError(`provider connection failed: ${(error as Error).message}`, null, true);
      if (attempt < maxRetries) await sleep(Math.min(400 * 2 ** attempt, 30_000));
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Math.max(400 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
      await sleep(Math.min(delay, 30_000));
      continue;
    }
    const text = await response.text();
    let payload: unknown = null;
    if (options.json !== false) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
    }
    return { status: response.status, payload, headers: response.headers, text };
  }
  throw lastError ?? new ProviderRequestError("provider request failed", null, true);
}
