import { z } from "zod";
import {
  CLAIM_KINDS,
  COVERAGE_STATES,
  DIMENSIONS,
  DOWNGRADE_REASONS,
  type ProductResearchResult,
} from "./types";

/**
 * Validates research results arriving at `/api/research/report`, and the
 * hand-authored fixture on its way into the demo path.
 *
 * The front end is the only caller of the route today, but this is where a
 * malformed result would turn into a silently wrong chart, so the boundary is
 * worth checking rather than trusting. The fixture goes through the very same
 * schema — a demo that renders different data than the live path is a demo that
 * lies about what the product does.
 *
 * Every vocabulary here is derived from `types.ts` rather than re-typed, so a
 * new coverage state or claim kind cannot be accepted by one layer and rejected
 * by another. Nothing here imports the HTTP framework: this module is the schema
 * layer, and the routes do the responding.
 */
export const SourceRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  retrievedAt: z.string(),
  tier: z.enum(["official", "thirdParty"]),
});

export const ClaimSchema = z.object({
  kind: z.enum(CLAIM_KINDS),
  text: z.string(),
  sourceIds: z.array(z.string()),
  downgradedFrom: z.enum(CLAIM_KINDS).optional(),
  downgradeReason: z.enum(DOWNGRADE_REASONS).optional(),
});

export const DimensionFindingSchema = z.object({
  dimension: z.enum(DIMENSIONS),
  state: z.enum(COVERAGE_STATES),
  summary: z.string(),
  hasEvidence: z.boolean(),
});

export const ProductResearchResultSchema = z.union([
  z.object({
    status: z.literal("failed"),
    error: z.string(),
    retryable: z.boolean(),
  }),
  z.object({
    status: z.enum(["done", "insufficient"]),
    name: z.string(),
    officialUrl: z.string().nullable(),
    oneLiner: z.string(),
    targetCustomer: z.string(),
    findings: z.array(DimensionFindingSchema),
    claims: z.array(ClaimSchema),
    sources: z.array(SourceRefSchema),
    gaps: z.array(z.string()),
    confirmedDimensions: z.number(),
  }),
]);

export const PricingInfoSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("quantified"),
    currency: z.string(),
    entryMonthly: z.number(),
    note: z.string(),
    sourceIds: z.array(z.string()),
  }),
  z.object({
    mode: z.literal("modelOnly"),
    model: z.string(),
    note: z.string(),
    sourceIds: z.array(z.string()),
  }),
  z.object({ mode: z.literal("unknown"), note: z.string() }),
]);

/**
 * The report's per-product card, minus the name. A card carries its own name in
 * the report array; in the fixture's insight map the name is the key instead, so
 * the two shapes genuinely differ and sharing one schema would mean accepting a
 * field the fixture never has.
 */
export const InsightDetailsSchema = z.object({
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  bestFor: z.string(),
  pricing: PricingInfoSchema,
});

export const ProductInsightSchema = InsightDetailsSchema.extend({ name: z.string() });

/** What `buildReport` returns and the report page renders. */
export const ComparisonReportSchema = z.object({
  goal: z.string(),
  generatedAt: z.string(),
  products: z.array(ProductInsightSchema),
  marketInsights: z.array(ClaimSchema),
  gaps: z.array(z.string()),
});

/**
 * What `src/fixtures/shape-example.json` must contain. The route boundary only
 * ever sees a `ProductResearchResult[]`; the fixture also carries the insight
 * stage's output, which the report renders directly and which therefore needs
 * the same scrutiny as anything else the page trusts. A misspelled claim `kind`
 * here used to be a render-time TypeError — a blank report — which is precisely
 * the failure the fixture exists to prevent.
 */
export const ReportFixtureSchema = z.object({
  goal: z.string(),
  generatedAt: z.string(),
  products: z.array(ProductResearchResultSchema),
  insights: z.record(z.string(), InsightDetailsSchema).optional(),
  marketInsights: z.array(ClaimSchema).optional(),
  gaps: z.array(z.string()).optional(),
});

/**
 * Reads a request body against a schema. Framework-free so the decision can be
 * asserted in a test; the route turns the result into a response.
 *
 * Both routes had this block copy-pasted, which is how two endpoints end up
 * with two different error shapes for the same mistake.
 */
export async function decodeJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "请求体不是合法 JSON" };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数校验失败" };
  }

  return { ok: true, data: parsed.data };
}

/**
 * The valid source-id set for the insight stage. Ids are only unique *within* a
 * product (`S1` exists for each), so the set is the union across products.
 */
export function collectSourceIds(results: readonly ProductResearchResult[]): Set<string> {
  return new Set(
    results.flatMap((r) => (r.status === "failed" ? [] : r.sources.map((s) => s.id))),
  );
}
