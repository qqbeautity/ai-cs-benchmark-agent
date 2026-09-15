import { DIMENSION_LABELS, type DimensionFinding, type SourceRef } from "./types";

/**
 * Builds the "what we could not confirm" list for one product.
 *
 * Extracted from `research.ts` and kept free of any server dependency so it can
 * be tested. It lived there untested, and that is exactly how a raw dimension id
 * (`integrations`, `security`) reached user-facing prose unnoticed: the slug was
 * interpolated straight into a sentence and nothing asserted otherwise.
 */
export function buildGaps(
  findings: readonly DimensionFinding[],
  sources: readonly SourceRef[],
  downgradedClaims: number,
): string[] {
  const gaps: string[] = [];
  const unknown = findings.filter((f) => f.state === "unknown");

  if (unknown.length > 0) {
    const labels = unknown.map((f) => DIMENSION_LABELS[f.dimension]);
    gaps.push(
      `以下维度公开资料不足：${labels.join("、")}。建议查看官方文档或申请试用确认。`,
    );
  }
  if (sources.length > 0 && sources.every((s) => s.tier === "thirdParty")) {
    gaps.push("本次未获取到官方来源，全部结论来自第三方页面，可信度有限。");
  }
  if (downgradedClaims > 0) {
    gaps.push(`${downgradedClaims} 条结论因模型引用的来源编号无法核实，已降级为「待确认」。`);
  }

  return gaps;
}
