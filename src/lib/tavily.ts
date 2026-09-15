import { serverEnv } from "./server-env";
import { RateLimitError, UpstreamError, withBackoff } from "./retry";
import type { SourceRef } from "./types";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export interface SearchHit {
  title: string;
  url: string;
  /** Extractive snippet Tavily already pulled from the page. */
  content: string;
}

/**
 * One Tavily call = 1 credit on the free tier. A full 5-product run costs 15
 * credits, so search count is a budgeted resource, not a free operation
 * (PLAN.md §3.4).
 *
 * No `include_domains` option: official-domain targeting is done with a `site:`
 * operator in `buildQueries`, which is one fewer request parameter to keep in
 * sync with the free-tier budget.
 */
export async function tavilySearch(
  query: string,
  options: { maxResults?: number } = {},
): Promise<SearchHit[]> {
  const { maxResults = 5 } = options;

  const body: Record<string, unknown> = {
    query,
    search_depth: "basic", // 'advanced' costs more credits
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
  };

  return withBackoff(
    async () => {
      const res = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverEnv.tavilyApiKey()}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        throw new RateLimitError("Tavily 限流", retryAfter ? Number(retryAfter) * 1000 : undefined);
      }
      if (!res.ok) {
        throw new UpstreamError(`Tavily 返回 ${res.status}`, res.status);
      }

      const data = (await res.json()) as TavilyResponse;
      return (data.results ?? [])
        .filter((r): r is TavilyResult & { url: string } => Boolean(r.url))
        .map((r) => ({
          title: r.title ?? r.url,
          url: r.url,
          content: (r.content ?? "").slice(0, 2000),
        }));
    },
    {
      onRetry: (_attempt, delay, error) =>
        console.warn(`[tavily] 重试中，等待 ${delay}ms：${(error as Error).message}`),
    },
  );
}

/** Domains that mean "the vendor talking about itself". */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function classifyTier(url: string, officialUrl?: string | null): SourceRef["tier"] {
  if (!officialUrl) return "thirdParty";
  const officialHost = hostOf(officialUrl);
  if (!officialHost) return "thirdParty";

  const host = hostOf(url);
  // Subdomains count as official: help.acme.com belongs to acme.com.
  const isOfficial =
    host === officialHost || host.endsWith(`.${officialHost}`) || officialHost.endsWith(`.${host}`);

  return isOfficial ? "official" : "thirdParty";
}

/**
 * Search a product by name, then search its official domain directly.
 * Official-domain results are moved to the front so a truncated prompt still
 * carries the authoritative pages (PLAN.md §3.5 step 3).
 */
export function buildQueries(
  name: string,
  officialUrl: string | null,
  allowThirdParty: boolean,
): string[] {
  const queries = [
    `${name} AI 客服 产品功能 官网`,
    `${name} 定价 价格 方案`,
    `${name} 知识库 RAG 人工接管 坐席辅助`,
  ];

  if (officialUrl) {
    queries.push(`site:${hostOf(officialUrl)} ${name} 功能 定价`);
  }
  // When third-party sourcing is off we still need *something* for products
  // with no official URL — the caller decides whether that is fatal
  // (PLAN.md §3.7a). We simply do not add directory-flavoured queries.
  if (!allowThirdParty) {
    return queries.slice(0, 1);
  }
  return queries;
}

export function dedupeByUrl(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = hit.url.split("#")[0].replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}
