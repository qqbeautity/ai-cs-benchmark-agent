import {
  buildChatBody,
  parseModelJson,
  readCompletion,
  type JsonSchemaSpec,
} from "./completion";
import { RateLimitError, UpstreamError, withBackoff } from "./retry";
import { serverEnv } from "./server-env";

export interface GenerateOptions {
  systemInstruction: string;
  userContent: string;
  /** Constrains the model to a JSON shape. Omit for free-form prose stages. */
  schema?: JsonSchemaSpec;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Minimal REST client for any OpenAI-compatible `/chat/completions` endpoint.
 * The official SDK adds weight we do not need and the request shape is stable,
 * so `fetch` keeps the dependency surface small.
 *
 * Everything about the wire format lives in `completion.ts`; what remains here
 * is env lookup and transport, which is the part that cannot be unit-tested
 * (`server-env.ts` is `server-only`). Keep it that way — logic that drifts back
 * into this file loses its tests.
 *
 * Serial by design: the caller runs one product at a time, so there is nothing
 * to gain from concurrency here.
 */
export async function generateJson<T>(options: GenerateOptions): Promise<T> {
  const model = serverEnv.llmModel();
  const jsonMode = serverEnv.llmJsonMode();
  const url = `${serverEnv.llmBaseUrl().replace(/\/+$/, "")}/chat/completions`;

  const body = buildChatBody(
    {
      ...options,
      maxOutputTokens: options.maxOutputTokens ?? serverEnv.llmMaxTokens(),
    },
    { model, jsonMode, disableThinking: serverEnv.llmDisableThinking() },
  );

  const text = await withBackoff(
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverEnv.llmApiKey()}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        throw new RateLimitError(
          "上游模型限流（RPM/RPD 已用尽）",
          retryAfter ? Number(retryAfter) * 1000 : undefined,
        );
      }
      if (!res.ok) {
        const detail = await readErrorDetail(res);
        throw new UpstreamError(
          `模型服务返回 ${res.status}${detail ? `：${detail}` : ""}`,
          res.status,
        );
      }

      return readCompletion(await res.json());
    },
    {
      attempts: 4,
      baseDelayMs: 2500,
      onRetry: (attempt, delay, error) =>
        console.warn(
          `[llm] 第 ${attempt} 次重试，等待 ${delay}ms：${(error as Error).message}`,
        ),
    },
  );

  return parseModelJson<T>(text);
}

/**
 * OpenAI-compatible errors arrive as `{"error":{"message":...}}`, but a gateway
 * in front of the model may return plain text or a redirect page. Prefer the
 * structured message; fall back to the raw body rather than reporting a bare
 * status code with no context.
 */
async function readErrorDetail(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    const message = parsed.error?.message ?? parsed.message;
    if (message) return message.slice(0, 300);
  } catch {
    // Not JSON — the raw body below is still better than nothing.
  }

  return raw.slice(0, 300);
}
