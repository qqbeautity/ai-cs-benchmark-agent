import { serverEnv } from "./server-env";
import { RateLimitError, UpstreamError, withBackoff } from "./retry";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export interface GenerateOptions {
  systemInstruction: string;
  userContent: string;
  /** JSON Schema; when present the model is constrained to emit valid JSON. */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Minimal REST client. The official SDK adds weight we do not need and the
 * request shape is stable, so `fetch` keeps the dependency surface small.
 */
export async function generateJson<T>(options: GenerateOptions): Promise<T> {
  const model = serverEnv.geminiModel();
  const url = `${BASE}/${model}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: options.systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: options.userContent }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxOutputTokens ?? 8192,
      ...(options.responseSchema
        ? {
            responseMimeType: "application/json",
            responseSchema: options.responseSchema,
          }
        : {}),
    },
    // Keep the model from narrating. Every safety setting stays at default.
    safetySettings: [],
  };

  const text = await withBackoff(
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": serverEnv.geminiApiKey(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        throw new RateLimitError(
          "Gemini 免费层限流（RPM/RPD 已用尽）",
          retryAfter ? Number(retryAfter) * 1000 : undefined,
        );
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new UpstreamError(
          `Gemini 返回 ${res.status}${detail ? `：${detail.slice(0, 300)}` : ""}`,
          res.status,
        );
      }

      const data = (await res.json()) as GeminiResponse;

      if (data.promptFeedback?.blockReason) {
        throw new UpstreamError(`内容被安全策略拦截：${data.promptFeedback.blockReason}`, 400);
      }

      const candidate = data.candidates?.[0];
      const out = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

      if (!out) {
        throw new UpstreamError(
          `模型返回空内容${candidate?.finishReason ? `（${candidate.finishReason}）` : ""}`,
          502,
        );
      }
      return out;
    },
    {
      attempts: 4,
      baseDelayMs: 2500,
      onRetry: (attempt, delay, error) =>
        console.warn(
          `[gemini] 第 ${attempt} 次重试，等待 ${delay}ms：${(error as Error).message}`,
        ),
    },
  );

  return parseModelJson<T>(text);
}

/**
 * `responseMimeType: application/json` usually gives us clean JSON, but models
 * still occasionally wrap it in a fenced block. Strip that before parsing and
 * report the raw text when parsing fails — a silent `undefined` here would
 * surface much later as a confusing render bug.
 */
export function parseModelJson<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new UpstreamError(`模型输出不是合法 JSON：${cleaned.slice(0, 200)}`, 502);
  }
}
