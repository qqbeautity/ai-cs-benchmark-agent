/**
 * Shared domain model for the whole app.
 * The report page renders *only* from these shapes, which is what lets the
 * pre-baked fixture and a live run share one render path (PLAN.md §3.6).
 *
 * This module imports nothing. Everything that both a client component and a
 * server module need belongs here, which is what keeps the client/server
 * boundary a single readable rule instead of a per-file judgement call.
 */

/** The ten analysis dimensions. Order is meaningful — it drives table column order. */
export const DIMENSIONS = [
  "positioning",
  "channels",
  "aiBot",
  "knowledgeBase",
  "humanHandoff",
  "workflow",
  "analytics",
  "integrations",
  "security",
  "pricing",
] as const;

export type DimensionId = (typeof DIMENSIONS)[number];

/** Derived, never hardcoded — "已确认 X/10" and the chart axis both read this. */
export const TOTAL_DIMENSIONS = DIMENSIONS.length;

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  positioning: "产品定位与目标客户",
  channels: "客服接入渠道",
  aiBot: "AI Bot 与自动回复",
  knowledgeBase: "知识库与 RAG",
  humanHandoff: "人工接管与坐席辅助",
  workflow: "工作流和自动化",
  analytics: "数据分析",
  integrations: "集成能力",
  security: "安全与部署",
  pricing: "定价及试用政策",
};

/**
 * Four-state coverage. `unknown` is a first-class value, not an error — the
 * whole point is that "we could not confirm this" is different from "no".
 */
export const COVERAGE_STATES = ["supported", "partial", "unsupported", "unknown"] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

/**
 * Colour is NEVER the only channel: each state ships an icon and a text label
 * so the matrix survives CVD, greyscale printing and forced-colors mode.
 * Status hues come from the reserved status palette — they are not data series.
 */
export const COVERAGE_META: Record<
  CoverageState,
  { label: string; icon: string; color: string }
> = {
  supported: { label: "支持", icon: "✓", color: "var(--status-good)" },
  partial: { label: "部分支持", icon: "◐", color: "var(--status-warning)" },
  unsupported: { label: "不支持", icon: "✕", color: "var(--status-critical)" },
  unknown: { label: "未知", icon: "?", color: "var(--status-unknown)" },
};

/** Provenance tier attached to every claim in the report. */
export const CLAIM_KINDS = ["verified", "inferred", "unconfirmed"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_META: Record<
  ClaimKind,
  { label: string; icon: string; description: string; color: string }
> = {
  verified: {
    label: "已核实事实",
    icon: "✓",
    description: "有网页证据，可点开来源核对",
    color: "var(--status-good)",
  },
  inferred: {
    label: "AI推断",
    icon: "◆",
    description: "根据多条已核实事实归纳，非原文陈述",
    color: "var(--series-1)",
  },
  unconfirmed: {
    label: "待确认",
    icon: "?",
    description: "公开资料不足或互相冲突，建议人工验证",
    color: "var(--status-warning)",
  },
};

/** Where a fact came from. `id` is the only thing a model is allowed to cite. */
export interface SourceRef {
  id: string;
  title: string;
  url: string;
  /** ISO date the page was fetched. */
  retrievedAt: string;
  /** Official domains outrank third-party blogs and directories. */
  tier: "official" | "thirdParty";
}

/**
 * Why a claim got downgraded. Only the first two have a producer today —
 * `bindSources` is the only writer and it emits nothing else. The other two are
 * declarable but nothing sets them, so they are not listed until something does.
 */
export const DOWNGRADE_REASONS = ["cited_source_not_found", "no_sources_retrieved"] as const;
export type DowngradeReason = (typeof DOWNGRADE_REASONS)[number];

/**
 * User-facing copy for a downgrade. Lives beside the reason it explains — the
 * report and the extraction module would otherwise have to be changed together
 * every time a reason is added.
 */
export const DOWNGRADE_LABELS: Record<DowngradeReason, string> = {
  cited_source_not_found: "模型引用的来源编号不存在于本次检索结果中，已降级为待确认",
  no_sources_retrieved: "该产品未能检索到任何网页，无法支撑事实性结论",
};

export function describeDowngrade(reason: DowngradeReason | undefined): string {
  return reason ? DOWNGRADE_LABELS[reason] : "证据不足";
}

/**
 * Strip anything that looks like a URL out of model prose before it reaches the
 * UI. The report renders links only from `SourceRef.url` (validated, fetched by
 * us), never from text the model produced. PLAN.md §2: "不直接生成和执行任意 HTML".
 *
 * Lives here rather than in `schema.ts` because the client derives the same
 * cards from the same text before the server's version arrives — a second copy
 * of this rule on the client is exactly the drift this file exists to prevent.
 */
const URL_LIKE = /https?:\/\/\S+|www\.\S+/gi;

export function sanitizeText(input: string): string {
  return input.replace(URL_LIKE, "[链接见来源]").trim();
}

export interface Claim {
  kind: ClaimKind;
  text: string;
  /** Source ids that survived validation. Empty for anything but `verified`. */
  sourceIds: string[];
  /** Set only when this claim started as `verified` and was demoted. */
  downgradedFrom?: ClaimKind;
  downgradeReason?: DowngradeReason;
}

/** One cell of the heat matrix. */
export interface DimensionFinding {
  dimension: DimensionId;
  state: CoverageState;
  /** One-sentence justification. May be empty when state is `unknown`. */
  summary: string;
  /** When true, an evidence-bound claim backs this cell. */
  hasEvidence: boolean;
}

/**
 * A product's state in the research queue. The last three mirror
 * `ProductResearchResult["status"]` by extraction rather than by a second
 * hand-written list, so adding a result status cannot leave this union behind.
 */
export type ProductStatus =
  | "pending"
  | "searching"
  | "extracting"
  | ProductResearchResult["status"];

export const PRODUCT_STATUS_META: Record<ProductStatus, { label: string; icon: string; color: string }> = {
  pending: { label: "等待", icon: "○", color: "var(--text-muted)" },
  // Both in-flight stages share a token: to the reader they are one wait.
  searching: { label: "搜索中", icon: "◌", color: "var(--series-1)" },
  extracting: { label: "抽取中", icon: "◌", color: "var(--series-1)" },
  done: { label: "已完成", icon: "✓", color: "var(--status-good)" },
  insufficient: { label: "信息不足", icon: "◐", color: "var(--status-warning)" },
  failed: { label: "失败", icon: "✕", color: "var(--status-critical)" },
};

/** Discriminated so the UI can never render a half-populated result. */
export type ProductResearchResult =
  | { status: "failed"; error: string; retryable: boolean }
  | {
      status: "done" | "insufficient";
      name: string;
      /** Only ever the URL the user typed — we never assert a site we guessed. */
      officialUrl: string | null;
      oneLiner: string;
      targetCustomer: string;
      findings: DimensionFinding[];
      claims: Claim[];
      sources: SourceRef[];
      gaps: string[];
      /** Number of dimensions with state !== 'unknown'. Drives the bar chart. */
      confirmedDimensions: number;
    };

export interface ProductResearchRequest {
  name: string;
  officialUrl?: string;
  allowThirdParty: boolean;
}

/** Narrowing helper. Lives here, not in `report.ts`, because client components
 *  need it and `report.ts` transitively pulls in the server-only API clients. */
export type DoneResult = Extract<ProductResearchResult, { status: "done" | "insufficient" }>;

export function isDone(result: ProductResearchResult): result is DoneResult {
  return result.status === "done" || result.status === "insufficient";
}

/** One product's card in the report: what it is good at, what it lacks, what it costs. */
export interface ProductInsight {
  name: string;
  strengths: string[];
  weaknesses: string[];
  bestFor: string;
  pricing: PricingInfo;
}

export interface ComparisonReport {
  goal: string;
  generatedAt: string;
  products: ProductInsight[];
  marketInsights: Claim[];
  gaps: string[];
}

export type PricingInfo =
  /**
   * Real numbers we can plot. Nothing produces this today: the extraction
   * contract has no numeric price field, because most vendors do not publish a
   * comparable figure and a chart of invented numbers is worse than no chart
   * (PLAN.md §2). The chart path stays wired for the day the model can fill it.
   */
  | { mode: "quantified"; currency: string; entryMonthly: number; note: string; sourceIds: string[] }
  /** Prices exist but are not comparable — show a table, never a fake chart. */
  | { mode: "modelOnly"; model: string; note: string; sourceIds: string[] }
  | { mode: "unknown"; note: string };

/**
 * The single producer of the per-product report cards, for both the live path
 * and the bundled fixture.
 *
 * `model` is whatever the insight stage returned for this product, prefilled
 * with the validated findings. The model supplies the qualitative card — it may
 * name a product we don't have, or skip one entirely, and that only ever costs
 * that one card its prose.
 *
 * The fallback describes *only* what the validated findings already say — a
 * dimension label plus the summary extracted from a cited page. Never a
 * qualitative claim invented to fill the card (PLAN.md §3.3).
 */
export function deriveProductInsights(
  products: readonly DoneResult[],
  model?: ReadonlyArray<Pick<ProductInsight, "name"> & Partial<Omit<ProductInsight, "name">>>,
): ProductInsight[] {
  const byName = new Map((model ?? []).map((m) => [m.name, m]));

  return products.map((product) => {
    const match = byName.get(product.name);

    return {
      name: product.name,
      strengths: (match?.strengths ?? fallbackStrengths(product)).map(sanitizeText),
      weaknesses: (match?.weaknesses ?? fallbackWeaknesses(product)).map(sanitizeText),
      bestFor: sanitizeText(match?.bestFor || product.targetCustomer || "信息不足"),
      pricing: derivePricing(product),
    };
  });
}

function summarize(dimension: DimensionId, summary: string): string {
  const label = DIMENSION_LABELS[dimension];
  if (!summary) return `${label}：公开资料确认具备`;
  const clipped = summary.length > 60 ? `${summary.slice(0, 60)}…` : summary;
  return `${label}：${clipped}`;
}

function fallbackStrengths(product: DoneResult): string[] {
  const supported = product.findings.filter((f) => f.state === "supported");
  return supported.length
    ? supported.slice(0, 4).map((f) => summarize(f.dimension, f.summary))
    : ["公开资料未确认任何维度的能力"];
}

function fallbackWeaknesses(product: DoneResult): string[] {
  return product.findings
    .filter((f) => f.state === "unknown")
    .map((f) => `${DIMENSION_LABELS[f.dimension]}：公开资料不足`);
}

/**
 * Pricing gets a table, not a chart, unless we genuinely have comparable
 * numbers. A bar chart of one bar per product is worse than a table, and
 * inventing a number to make the chart work is worse still (PLAN.md §2).
 */
function derivePricing(product: DoneResult): PricingInfo {
  const pricing = product.findings.find((f) => f.dimension === "pricing");

  if (!pricing || pricing.state === "unknown" || !pricing.summary) {
    return { mode: "unknown", note: "未找到公开定价信息，需联系销售或申请试用" };
  }

  return {
    mode: "modelOnly",
    model: pricing.summary,
    note: "公开资料仅描述计费方式，缺少可直接比较的价格数字，因此以表格呈现。",
    sourceIds: [],
  };
}
