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
  geminiApiKey: () => required("GEMINI_API_KEY"),
  /** Configurable on purpose — free-tier model availability changes (PLAN.md §3.3). */
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-2.5-flash",
  maxSearchesPerProduct: () => Number(process.env.TAVILY_MAX_SEARCHES_PER_PRODUCT ?? 3),
};
