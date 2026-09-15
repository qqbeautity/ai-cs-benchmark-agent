/**
 * Server-only configuration.
 *
 * The `server-only` import is the real guard: it makes the *build* fail if any
 * client component reaches this module, instead of throwing in the browser
 * after the bundle has already shipped the keys. That is exactly the bug this
 * file caused the first time around — `report.ts` needed `isDone`, a client
 * component imported it, and the whole page white-screened.
 *
 * If you need something from here in a client component, the value belongs in
 * `types.ts` or your own module — never in this one.
 */
import "server-only";

import type { JsonMode } from "./completion";

/**
 * A missing key cannot be fixed by trying again, so research failures branch on
 * this class rather than on the text of the message. Matching on a message
 * substring meant that editing the copy below silently reclassified every
 * misconfiguration as retryable, and shipped a retry button that could never
 * work (PLAN.md §5).
 */
export class ConfigError extends Error {
  constructor(name: string) {
    super(
      `缺少环境变量 ${name}。复制 .env.example 为 .env.local 并填入，或改用示例报告（无需 Key）。`,
    );
    this.name = "ConfigError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(name);
  return value;
}

export const serverEnv = {
  tavilyApiKey: () => required("TAVILY_API_KEY"),

  llmApiKey: () => required("LLM_API_KEY"),

  /**
   * 阿里云百炼的 OpenAI 兼容端点。**区域绑定**：国内控制台签发的 Key 只能配国内站，
   * 配成新加坡站会报 InvalidApiKey。换厂商只需要改这一个变量。
   */
  llmBaseUrl: () =>
    process.env.LLM_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",

  /**
   * Configurable on purpose — model availability changes (PLAN.md §3.3).
   *
   * The fallback matches `.env.example` so the two files cannot disagree. It is
   * the one combination that was actually measured end to end (strict
   * `json_schema` accepted, `enable_thinking: false` accepted); `qwen-plus`,
   * the previous fallback, was never verified against either.
   */
  llmModel: () => process.env.LLM_MODEL || "qwen3.8-max",

  /**
   * `json_schema` 让 provider 在解码层强约束输出结构；`json_object` 只保证是合法
   * JSON，schema 退化成提示词里的描述。默认前者，但严格模式的模型覆盖很窄——
   * 换到不支持的模型会直接 400，此时降到 json_object。详见 completion.ts。
   */
  llmJsonMode: (): JsonMode =>
    process.env.LLM_JSON_MODE === "json_object" ? "json_object" : "json_schema",

  /**
   * 关掉模型的思考模式。`qwen3.8-max` 默认开着，实测一个 5 token 的答案烧掉 50 个
   * completion token（38 个是推理），而十维抽取的输出有几千 token——推理和正文共享
   * `LLM_MAX_TOKENS`，所以不关的话截断风险明显更高，延迟和费用也一起涨。
   *
   * **不设时完全不发这个字段**，而不是发 `false`：`enable_thinking` 是
   * Qwen/DashScope 的私有扩展，默认请求体必须对标准 OpenAI 端点也成立。也正因为
   * 如此，这里没有「默认值」可言——厂商默认行为取决于厂商。
   */
  llmDisableThinking: () => {
    const raw = process.env.LLM_DISABLE_THINKING?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  },

  /** 结构化输出的截断会产生非法 JSON，所以这个值只该调大不该调小。 */
  llmMaxTokens: () => Number(process.env.LLM_MAX_TOKENS ?? 8192),

  maxSearchesPerProduct: () => Number(process.env.TAVILY_MAX_SEARCHES_PER_PRODUCT ?? 3),
};
