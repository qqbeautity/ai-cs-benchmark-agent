"use client";

import {
  COVERAGE_META,
  DIMENSIONS,
  DIMENSION_LABELS,
  type DimensionId,
  type DoneResult,
} from "@/lib/types";

/**
 * Ten dimensions x N products as a matrix of state cells.
 *
 * A grouped bar chart cannot carry 5 x 10 = 50 comparisons, and the values are
 * categorical states (supported / partial / unsupported / unknown) rather than
 * magnitudes — so a heat matrix is the correct form, not a decoration choice.
 */
export function DimensionMatrix({ products }: { products: DoneResult[] }) {
  const findingsByProduct = products.map((p) => ({
    product: p,
    byDimension: new Map<DimensionId, (typeof p.findings)[number]>(
      p.findings.map((f) => [f.dimension, f]),
    ),
  }));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <caption className="sr-only">
          各产品在十个分析维度上的能力覆盖情况，共四种状态
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-[1] border-b px-3 py-2 text-left text-xs font-medium"
              style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-secondary)" }}
            >
              维度
            </th>
            {findingsByProduct.map(({ product }) => (
              <th
                key={product.name}
                scope="col"
                className="border-b px-3 py-2 text-left text-xs font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                {product.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DIMENSIONS.map((dimension) => (
            <tr key={dimension}>
              <th
                scope="row"
                className="sticky left-0 z-[1] border-b px-3 py-2 text-left text-xs font-normal"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--surface-1)",
                  color: "var(--text-secondary)",
                }}
              >
                {DIMENSION_LABELS[dimension]}
              </th>
              {findingsByProduct.map(({ product, byDimension }) => {
                const finding = byDimension.get(dimension);
                const meta = COVERAGE_META[finding?.state ?? "unknown"];
                const cellTitle = [
                  `${product.name} · ${DIMENSION_LABELS[dimension]}`,
                  `状态：${meta.label}`,
                  finding?.summary || "公开资料未提供可核实的信息",
                  finding?.hasEvidence ? "有证据来源" : "无证据来源",
                ].join("\n");

                return (
                  <td
                    key={product.name}
                    className="border-b px-3 py-2 align-top"
                    style={{ borderColor: "var(--border)" }}
                    title={cellTitle}
                  >
                    {/* Icon + text, so state never depends on colour alone. */}
                    <span className="state-chip">
                      <span aria-hidden style={{ color: meta.color }}>
                        {meta.icon}
                      </span>
                      {meta.label}
                    </span>
                    {finding?.summary && (
                      <p
                        className="mt-1 text-xs leading-snug"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {finding.summary}
                      </p>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap gap-3">
        {Object.entries(COVERAGE_META).map(([state, meta]) => (
          <span key={state} className="state-chip">
            <span aria-hidden style={{ color: meta.color }}>
              {meta.icon}
            </span>
            {meta.label}
          </span>
        ))}
      </div>
    </div>
  );
}
