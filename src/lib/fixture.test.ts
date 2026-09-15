import { describe, expect, it } from "vitest";
import raw from "@/fixtures/shape-example.json";
import { ProductResearchResultSchema, ReportFixtureSchema } from "./validate-result";
import { isDone } from "./types";

/**
 * The fixture is the most fragile file in the repo: hand-authored JSON that the
 * demo renders directly. If it drifts from the shipped contract the demo
 * silently renders an empty report — which is exactly the failure the fixture
 * exists to prevent.
 *
 * The file holds placeholder data until someone runs `npm run fixture --force`,
 * after which it holds a real run. Both are valid; the assertions below split
 * on `_placeholder` so the same suite holds in either state.
 */
describe("shape-example.json", () => {
  const meta = raw as unknown as { _placeholder?: boolean; _note?: string };
  const isPlaceholder = meta._placeholder === true;

  it("validates as a whole against the schema the demo path uses", () => {
    // `loadSampleReport` parses the entire file, so a typo anywhere in it —
    // including in `marketInsights` or `gaps`, which used to be asserted
    // through without checking — is a blank report. Fail here instead.
    const parsed = ReportFixtureSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`${issue?.path.join(".") || "(根)"} — ${issue?.message}`);
    }
  });

  const products = (raw as unknown as { products: unknown[] }).products;

  it("has at least the three products a report needs", () => {
    expect(products.length).toBeGreaterThanOrEqual(3);
  });

  it("every entry validates against the shipped result schema", () => {
    products.forEach((product, index) => {
      const parsed = ProductResearchResultSchema.safeParse(product);
      if (!parsed.success) {
        throw new Error(`第 ${index} 个产品结构不合法：${parsed.error.issues[0]?.message}`);
      }
    });
  });

  it("includes at least two usable products so the matrix is not degenerate", () => {
    const usable = products.filter((p) =>
      isDone(ProductResearchResultSchema.parse(p) as never),
    );
    expect(usable.length).toBeGreaterThanOrEqual(2);
  });

  it("every claim's sourceIds resolve to a real source", () => {
    for (const candidate of products) {
      const parsed = ProductResearchResultSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.status === "failed") continue;

      const ids = new Set(parsed.data.sources.map((s) => s.id));
      for (const claim of parsed.data.claims) {
        for (const sourceId of claim.sourceIds) {
          expect(
            ids.has(sourceId),
            `结论「${claim.text}」引用了不存在的来源 ${sourceId}`,
          ).toBe(true);
        }
      }
    }
  });

  it("every non-unknown dimension with a summary carries evidence", () => {
    for (const candidate of products) {
      const parsed = ProductResearchResultSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.status === "failed") continue;

      for (const finding of parsed.data.findings) {
        if (finding.state !== "unknown") {
          expect(
            finding.hasEvidence,
            `维度 ${finding.dimension} 声称「${finding.state}」但没有证据`,
          ).toBe(true);
        }
      }
    }
  });

  it("says in the file itself which kind of data it is", () => {
    // Guards both directions: placeholder data must announce itself (the page
    // shows a banner), and a real run must say so — otherwise a stale
    // placeholder banner would sit on top of real research.
    expect(meta._note).toBeTruthy();
    expect(typeof meta._placeholder).toBe("boolean");
  });

  it("carries real market insights once it is no longer a placeholder", () => {
    if (isPlaceholder) return;
    const insights = (raw as unknown as { marketInsights?: unknown[] }).marketInsights ?? [];
    expect(insights.length).toBeGreaterThan(0);
  });
});
