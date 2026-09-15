import { describe, expect, it, vi } from "vitest";
import { RateLimitError, UpstreamError, withBackoff, type BackoffOptions } from "./retry";

/** Never actually sleeps — tests must stay fast and deterministic. */
const noSleep = { sleep: async () => {} } satisfies BackoffOptions;

describe("withBackoff", () => {
  it("returns immediately on success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withBackoff(fn, noSleep)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and succeeds — the routine case on a free tier", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError("限流"))
      .mockResolvedValueOnce("ok");

    const onRetry = vi.fn();
    await expect(withBackoff(fn, { ...noSleep, onRetry })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("retries 5xx from the upstream provider", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamError("bad gateway", 502))
      .mockResolvedValueOnce("ok");

    await expect(withBackoff(fn, noSleep)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx that will never resolve", async () => {
    const fn = vi.fn().mockRejectedValue(new UpstreamError("bad request", 400));

    await expect(withBackoff(fn, noSleep)).rejects.toThrow("bad request");
    // Retrying a malformed request just burns rate limit budget.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt budget and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new RateLimitError("一直限流"));

    await expect(withBackoff(fn, { ...noSleep, attempts: 3 })).rejects.toThrow("一直限流");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("backs off exponentially", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new RateLimitError("限流"));

    await expect(
      withBackoff(fn, {
        attempts: 4,
        baseDelayMs: 100,
        maxDelayMs: 10_000,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow();

    expect(delays).toEqual([100, 200, 400]);
  });

  it("honours a Retry-After hint over the computed backoff", async () => {
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError("限流", 7000))
      .mockResolvedValueOnce("ok");

    await withBackoff(fn, {
      baseDelayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(delays).toEqual([7000]);
  });
});
