/**
 * The provider-independent half of the model call: everything about the
 * OpenAI-compatible chat wire format that is pure data-in/data-out.
 *
 * This module exists so that half can be tested. `llm.ts` imports
 * `server-env.ts`, which carries `import "server-only"` and therefore throws
 * under vitest — that is the actual reason the request body and the response
 * envelope had no coverage (README.md "已知状态"). Keeping the transport in
 * one file and the shape-shuffling in this one means only the transport is
 * untestable, and the transport is now nine lines of `fetch`.
 *
 * Nothing here may import `server-env.ts`, directly or transitively.
 */
import { UpstreamError } from "./retry";

/**
 * `json_schema` asks the provider to constrain generation to the schema.
 * `json_object` only guarantees parseable JSON — the schema then reaches the
 * model as prompt text instead of as a decoding constraint.
 */
export type JsonMode = "json_schema" | "json_object";

export interface JsonSchemaSpec {
  /** Provider-side schema name; letters, digits, `_` and `-` only, max 64 chars. */
  name: string;
  schema: Record<string, unknown>;
}

export interface CompletionRequest {
  systemInstruction: string;
  userContent: string;
  /**
   * Omit for the insight stage, which takes whatever prose shape it gets and
   * validates downstream.
   */
  schema?: JsonSchemaSpec;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ChatBodyOptions {
  model: string;
  jsonMode: JsonMode;
  /**
   * Ask the provider to skip its reasoning phase.
   *
   * Off by default, and when off the field is `omit`ted rather than sent as
   * `false`: `enable_thinking` is a Qwen/DashScope extension, and the default
   * request body has to stay acceptable to a plain OpenAI-compatible endpoint
   * that might reject unknown keys.
   */
  disableThinking?: boolean;
}

/**
 * DashScope spells "skip the reasoning phase" `enable_thinking: false`; the
 * console's own sample code emits it. `thinking: {type: "disabled"}` is a
 * second spelling that means the same thing. Both were measured against
 * `qwen3.8-max` on the workspace endpoint and both work — pick one, do not
 * send both.
 */
const DISABLE_THINKING_FIELD = { enable_thinking: false } as const;

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/**
 * The schema goes into the prompt *and* (when available) into `response_format`.
 *
 * That redundancy is deliberate. Provider documentation disagrees about whether
 * the OpenAI-compatible endpoints honour `json_schema` or quietly downgrade it
 * to `json_object`, and a downgrade raises nothing — you would keep believing
 * the decoding constraint was in force. Putting the same description in the
 * prompt makes the two paths behave the same, so a silent downgrade costs
 * reliability rather than correctness.
 *
 * It also keeps one source of truth: `EXTRACTION_RESPONSE_SCHEMA` is rendered
 * from here, never re-typed as prose.
 */
export function renderSchemaForPrompt(spec: JsonSchemaSpec): string {
  return [
    "输出必须严格符合以下 JSON Schema：",
    JSON.stringify(spec.schema, null, 2),
  ].join("\n");
}

export function buildChatBody(
  request: CompletionRequest,
  options: ChatBodyOptions,
): Record<string, unknown> {
  const system = request.schema
    ? `${request.systemInstruction}\n\n${renderSchemaForPrompt(request.schema)}`
    : request.systemInstruction;

  const useStrictSchema = Boolean(request.schema) && options.jsonMode === "json_schema";

  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: request.userContent },
    ],
    temperature: request.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    response_format: useStrictSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: request.schema!.name,
            strict: true,
            schema: request.schema!.schema,
          },
        }
      : // Always send *something*: `json_object` requires the word "JSON" to
        // appear in the messages, which both system instructions already end
        // with, and the insight call asks for specific keys in the prompt.
        { type: "json_object" },
  };

  // Reasoning tokens land in the same `completion_tokens` bucket as the answer
  // and count against `max_tokens`, so thinking mode eats the room reserved for
  // the JSON. Measured on qwen3.8-max: a five-token answer cost fifty.
  if (options.disableThinking) Object.assign(body, DISABLE_THINKING_FIELD);

  return body;
}

interface ChatCompletion {
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: string;
  }>;
  error?: { message?: string };
}

/**
 * Pull the text out of a chat completion, turning the two ways a provider can
 * hand back something unusable into errors that name the actual problem.
 *
 * Truncation is the one worth calling out: without this check it surfaces
 * downstream as "模型输出不是合法 JSON", which sends you looking at the prompt
 * when the fix is a larger token budget.
 */
export function readCompletion(data: unknown): string {
  const completion = data as ChatCompletion | null;
  const choice = completion?.choices?.[0];

  if (!choice) {
    const detail = completion?.error?.message;
    throw new UpstreamError(
      `模型服务未返回候选结果${detail ? `：${detail.slice(0, 300)}` : ""}`,
      502,
    );
  }

  const finish = choice.finish_reason;

  if (finish === "length") {
    // Retryable: output length varies per run, so one retry can legitimately
    // succeed where this attempt ran out of room.
    throw new UpstreamError(
      "模型输出被 max_tokens 截断，JSON 不完整。请调大 LLM_MAX_TOKENS 后重试；" +
        "若该模型默认开启思考模式，推理 token 也计入这个上限，设 LLM_DISABLE_THINKING=1 可腾出空间。",
      502,
    );
  }
  if (finish === "content_filter") {
    throw new UpstreamError("内容被模型服务的安全策略拦截", 400);
  }

  const content = choice.message?.content;
  const text = typeof content === "string" ? content : "";

  if (!text.trim()) {
    const shape = content === undefined ? "content 缺失" : `content 类型为 ${typeof content}`;
    throw new UpstreamError(
      `模型返回空内容（${finish ?? "无 finish_reason"}，${shape}）`,
      502,
    );
  }

  return text;
}

/**
 * `response_format: json_object` usually gives us clean JSON, but models still
 * occasionally wrap it in a fenced block. Strip that before parsing and report
 * the raw text when parsing fails — a silent `undefined` here would surface
 * much later as a confusing render bug.
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
