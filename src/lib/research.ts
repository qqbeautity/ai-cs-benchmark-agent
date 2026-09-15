import { ConfigError, serverEnv } from "./server-env";
import { generateJson } from "./gemini";
import {
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTION_SYSTEM,
  buildExtractionPrompt,
} from "./prompts";
import {
  RawExtractionSchema,
  bindFindings,
  bindSources,
  countConfirmed,
  makeSourceId,
} from "./schema";
import { buildQueries, classifyTier, dedupeByUrl, tavilySearch, type SearchHit } from "./tavily";
import { buildGaps } from "./gaps";
import type {
  Claim,
  ProductResearchRequest,
  ProductResearchResult,
  SourceRef,
} from "./types";

/** How much page text per source goes into the prompt. */
const SNIPPET_BUDGET = 1800;
/** Cap on sources handed to the model, to stay inside free-tier token budgets. */
const MAX_SOURCES = 10;

export interface ResearchOptions {
  log?: (message: string) => void;
}

export async function researchProduct(
  request: ProductResearchRequest,
  options: ResearchOptions = {},
): Promise<ProductResearchResult> {
  const { log = () => {} } = options;
  const officialUrl = normalizeUrl(request.officialUrl);

  try {
    const queries = buildQueries(request.name, officialUrl, request.allowThirdParty);
    const maxSearches = serverEnv.maxSearchesPerProduct();
    const usedQueries = queries.slice(0, maxSearches);

    log(`[${request.name}] 执行 ${usedQueries.length} 次搜索（预算 ${maxSearches} credits）`);

    // Searches run sequentially: the free tier is credit-metered and the
    // per-product result is fetched inside one function invocation, so there
    // is nothing to gain from fanning out and burning rate limit headroom.
    const hitSets: SearchHit[][] = [];
    for (const query of usedQueries) {
      hitSets.push(await tavilySearch(query, { maxResults: 5 }));
    }

    let hits = dedupeByUrl(hitSets.flat());

    // Official-first ordering. When third-party sourcing is disabled we keep
    // only official hits — and if that empties the list we say so instead of
    // silently widening the net (PLAN.md §3.7a).
    if (officialUrl) {
      const official = hits.filter((h) => classifyTier(h.url, officialUrl) === "official");
      const rest = hits.filter((h) => classifyTier(h.url, officialUrl) !== "official");
      hits = request.allowThirdParty ? [...official, ...rest] : official;
    } else if (!request.allowThirdParty) {
      hits = [];
    }

    const trimmed = hits.slice(0, MAX_SOURCES);

    if (trimmed.length === 0) {
      return {
        status: "insufficient",
        name: request.name,
        officialUrl,
        oneLiner: "",
        targetCustomer: "",
        findings: bindFindings({ dimensions: [], claims: [] } as never, new Set()),
        claims: [],
        sources: [],
        gaps: [
          request.allowThirdParty
            ? "未检索到任何相关网页，建议手动补充官网地址后重试"
            : "已关闭第三方来源，且未提供官网地址，因此无法获取任何资料",
        ],
        confirmedDimensions: 0,
      };
    }

    const retrievedAt = new Date().toISOString().slice(0, 10);
    const sources: SourceRef[] = trimmed.map((hit, index) => ({
      id: makeSourceId(index),
      title: hit.title,
      url: hit.url,
      retrievedAt,
      tier: classifyTier(hit.url, officialUrl),
    }));

    const snippets = new Map<string, string>();
    trimmed.forEach((hit, index) => {
      snippets.set(makeSourceId(index), hit.content.slice(0, SNIPPET_BUDGET));
    });

    const validSourceIds = new Set(sources.map((s) => s.id));

    log(`[${request.name}] 送入模型 ${sources.length} 个来源`);

    const raw = await generateJson<unknown>({
      systemInstruction: EXTRACTION_SYSTEM,
      userContent: buildExtractionPrompt(request.name, sources, snippets, officialUrl),
      responseSchema: EXTRACTION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    });

    const parsed = RawExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: "failed",
        error: `模型输出结构不符合预期：${parsed.error.issues[0]?.message ?? "未知字段错误"}`,
        retryable: true,
      };
    }

    // The model is asked for one entry per product; guard against it echoing
    // back several products or none at all.
    const product =
      parsed.data.products.find(
        (p) => p.name.trim().toLowerCase() === request.name.trim().toLowerCase(),
      ) ?? parsed.data.products[0];

    if (!product) {
      return { status: "failed", error: "模型未返回该产品的调研结果", retryable: true };
    }

    const findings = bindFindings(product, validSourceIds);
    const claims: Claim[] = product.claims.map((c) => bindSources(c, validSourceIds));
    const confirmedDimensions = countConfirmed(findings);

    const downgraded = claims.filter((c) => c.kind === "unconfirmed").length;
    log(
      `[${request.name}] 完成：${confirmedDimensions}/10 维度已确认，` +
        `${claims.length} 条结论（${downgraded} 条因来源校验失败降级）`,
    );

    const gaps = buildGaps(findings, sources, downgraded);

    return {
      status: confirmedDimensions >= 3 ? "done" : "insufficient",
      name: product.name || request.name,
      officialUrl,
      oneLiner: product.oneLiner,
      targetCustomer: product.targetCustomer,
      findings,
      claims,
      sources,
      gaps,
      confirmedDimensions,
    };
  } catch (error) {
    const message = (error as Error).message ?? "未知错误";
    log(`[${request.name}] 失败：${message}`);
    return {
      status: "failed",
      error: message,
      // Rate limits and 5xx clear on their own; a missing key will not.
      retryable: !(error instanceof ConfigError),
    };
  }
}

function normalizeUrl(input?: string): string | null {
  if (!input?.trim()) return null;
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}
