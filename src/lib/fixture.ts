import example from "@/fixtures/shape-example.json";
import { ReportFixtureSchema } from "./validate-result";
import { deriveProductInsights, isDone } from "./types";
import type { Claim, ProductInsight, ProductResearchResult } from "./types";

export interface ReportFixture {
  goal: string;
  generatedAt: string;
  products: ProductResearchResult[];
  insights: ProductInsight[];
  marketInsights: Claim[];
  gaps: string[];
}

/**
 * Loads the bundled sample report.
 *
 * This is the demo path and it must never touch the network: a visitor with no
 * API key, an exhausted free tier, or a rate-limited model still gets a full
 * report.
 *
 * The whole file is validated in one pass against the schema the live path
 * uses. It used to `safeParse` each product and skip the ones that failed while
 * asserting its way through `marketInsights` and `gaps` — so a typo in a claim
 * `kind` became a render-time TypeError (a blank report) and a fixture that lost
 * half its products rendered quietly as a smaller report. Both of those are
 * precisely the failures the fixture exists to prevent, so a malformed fixture
 * now fails loudly instead of degrading (PLAN.md §3.6).
 */
export function loadSampleReport(): ReportFixture {
  const parsed = ReportFixtureSchema.safeParse(example);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `示例数据不符合当前结构：${issue?.path.join(".") || "(根)"} — ${issue?.message ?? "未知错误"}`,
    );
  }

  const { goal, generatedAt, products, insights, marketInsights, gaps } = parsed.data;
  const usable = products.filter(isDone);

  return {
    goal,
    generatedAt,
    products,
    // The fixture ships the insight stage's output keyed by product name.
    // Anything it does not cover falls back to the same derivation the live
    // path uses, so a product renamed in one place cannot blank its card.
    insights: deriveProductInsights(
      usable,
      Object.entries(insights ?? {}).map(([name, details]) => ({ name, ...details })),
    ),
    marketInsights: marketInsights ?? [],
    gaps: [...new Set(gaps ?? [])],
  };
}

export function isPlaceholderFixture(): boolean {
  return Boolean((example as unknown as { _placeholder?: boolean })._placeholder);
}
