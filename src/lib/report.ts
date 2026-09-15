import { z } from "zod";
import { generateJson } from "./llm";
import { INSIGHT_SYSTEM, buildInsightPrompt } from "./prompts";
import { bindSources } from "./schema";
import { DIMENSION_LABELS, deriveProductInsights, isDone, sanitizeText } from "./types";
import type { ComparisonReport, DoneResult, ProductResearchResult } from "./types";

const InsightResponseSchema = z.object({
  products: z
    .array(
      z.object({
        name: z.string(),
        strengths: z.array(z.string()).default([]),
        weaknesses: z.array(z.string()).default([]),
        bestFor: z.string().default(""),
      }),
    )
    .default([]),
  marketInsights: z
    .array(
      z.object({
        // The model's claim; `bindSources` decides the kind that survives.
        kind: z.enum(["verified", "inferred", "unconfirmed"]),
        text: z.string(),
        sourceIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  gaps: z.array(z.string()).default([]),
});

export type InsightProduct = z.infer<typeof InsightResponseSchema>["products"][number];

/** What the insight stage contributes: prose per product, no pricing. */
type InsightProse = Pick<InsightProduct, "name" | "strengths" | "weaknesses" | "bestFor">;

interface InsightStage {
  products: InsightProse[];
  marketInsights: z.infer<typeof InsightResponseSchema>["marketInsights"];
  gaps: string[];
}

/**
 * Adds the insight stage's prose to a set of validated results.
 *
 * The prose is the *only* thing this stage contributes. Strengths, weaknesses
 * and pricing all come from `deriveProductInsights` off the validated findings,
 * so the live path and the fixture path produce the same cards from the same
 * code — there is no second, slowly-diverging derivation for the client to run.
 */
export async function buildReport(
  goal: string,
  results: ProductResearchResult[],
  allSourceIds: ReadonlySet<string>,
): Promise<ComparisonReport> {
  const usable = results.filter(isDone);

  if (usable.length === 0) {
    throw new Error("没有任何产品调研成功，无法生成横评报告");
  }

  const insight = await generateInsights(goal, usable);
  // Only the prose transfers, and it goes through the same URL check as
  // everything else that reaches the page — links render from validated
  // `SourceRef.url` alone.
  const prose = insight.products.map((p) => ({
    name: p.name,
    strengths: p.strengths.map(sanitizeText),
    weaknesses: p.weaknesses.map(sanitizeText),
    bestFor: sanitizeText(p.bestFor),
  }));

  return {
    goal,
    generatedAt: new Date().toISOString(),
    products: deriveProductInsights(usable, prose),
    marketInsights: insight.marketInsights.map((c) => bindSources(c, allSourceIds)),
    gaps: dedupe([
      ...insight.gaps.map(sanitizeText),
      ...usable.flatMap((p) => p.gaps),
    ]),
  };
}

/**
 * The one non-essential stage. The comparison matrix is already built from
 * validated facts, so a rate-limited or malformed insight call must degrade to
 * the programmatic fallback rather than fail the whole report.
 */
async function generateInsights(goal: string, usable: DoneResult[]): Promise<InsightStage> {
  const empty: InsightStage = { products: [], marketInsights: [], gaps: [] };

  try {
    // No `schema`: this stage's shape is described in the prompt and validated
    // by `InsightResponseSchema` below. `buildChatBody` still asks for
    // `json_object`, so the common failure here is a wrong shape rather than
    // unparseable text — both land in the same fallback.
    const raw = await generateJson<unknown>({
      systemInstruction: INSIGHT_SYSTEM,
      userContent: buildInsightPrompt(
        goal,
        usable.map((p) => ({
          name: p.name,
          oneLiner: p.oneLiner,
          findings: p.findings.map((f) => ({
            dimension: DIMENSION_LABELS[f.dimension],
            state: f.state,
            summary: f.summary,
          })),
          gaps: p.gaps,
        })),
      ),
    });

    const parsed = InsightResponseSchema.safeParse(raw);
    if (parsed.success) return parsed.data;

    console.warn("[report] 洞察输出结构不符，退回程序化归纳");
    return empty;
  } catch (error) {
    console.warn(`[report] 洞察生成失败，退回程序化归纳：${(error as Error).message}`);
    return empty;
  }
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}
