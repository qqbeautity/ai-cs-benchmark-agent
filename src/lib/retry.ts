/**
 * Exponential backoff for rate limits.
 *
 * The Gemini free tier sits around 10-30 RPM and the Tavily free tier is
 * credit-metered, so a 429 in this app is a *routine* event, not an exception.
 * Without this, a demo stalls in front of the interviewer (PLAN.md §3.3).
 */

export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface BackoffOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  /** Injectable so tests do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof UpstreamError) return error.status >= 500 || error.status === 408;
  return false;
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 2000,
    maxDelayMs = 20000,
    onRetry,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw error;

      const hinted = error instanceof RateLimitError ? error.retryAfterMs : undefined;
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = hinted ?? backoff;

      onRetry?.(attempt, delay, error);
      await sleep(delay);
    }
  }

  throw lastError;
}
