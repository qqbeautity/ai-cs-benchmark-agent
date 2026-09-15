"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ClaimList, SourceList } from "@/components/claim-list";
import { CoverageChart } from "@/components/coverage-chart";
import { DimensionMatrix } from "@/components/dimension-matrix";
import { loadTask, type StoredTask } from "@/lib/task-store";
import { isPlaceholderFixture, loadSampleReport } from "@/lib/fixture";
import {
  deriveProductInsights,
  isDone,
  type ComparisonReport,
  type DoneResult,
  type PricingInfo,
  type ProductInsight,
} from "@/lib/types";

export default function ReportPage() {
  return (
    <Suspense fallback={<p className="text-sm">载入中…</p>}>
      <ReportView />
    </Suspense>
  );
}

function ReportView() {
  const params = useSearchParams();
  const demo = params.get("demo") === "1";

  const [task, setTask] = useState<StoredTask | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!demo) setTask(loadTask());
    setLoaded(true);
  }, [demo]);

  const fixture = useMemo(() => (demo ? loadSampleReport() : null), [demo]);
  const isPlaceholder = useMemo(() => (demo ? isPlaceholderFixture() : false), [demo]);

  // Fixtures are hand-authored for a demo path, so they do not go through the
  // model. Anything derived from model output is the reader's to check.
  const [report, setReport] = useState<ComparisonReport | null>(null);

  const usable = useMemo<DoneResult[]>(() => {
    if (demo) return (fixture?.products ?? []).filter(isDone);
    return task ? Object.values(task.results).filter(isDone) : [];
  }, [demo, fixture, task]);

  useEffect(() => {
    if (demo || !task) return;

    const allResults = Object.values(task.results);
    if (allResults.length === 0) return;

    // The insight stage is non-essential: the matrix and coverage chart are
    // already built from validated facts, so a failure here degrades to the
    // per-product gap list rather than blocking the report.
    void fetch("/api/research/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: task.goal, results: allResults }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: ComparisonReport) => setReport(data))
      .catch((error) => {
        console.warn("洞察生成失败，报告其余部分不受影响：", error);
        setReport({
          goal: task.goal,
          generatedAt: task.createdAt,
          products: [],
          marketInsights: [],
          gaps: [],
        });
      });
  }, [demo, task]);

  // The cards come from the server, which is the only place the model's prose
  // exists. Until that lands — and if it never does — the same derivation runs
  // over the validated findings, so the section is never empty and never shows
  // a second, divergent version of the same card.
  const products = useMemo<ProductInsight[]>(() => {
    if (demo) return fixture?.insights ?? [];
    return report?.products.length ? report.products : deriveProductInsights(usable);
  }, [demo, fixture, usable, report]);

  const byName = useMemo(() => new Map(products.map((p) => [p.name, p])), [products]);

  const marketInsights = report?.marketInsights ?? fixture?.marketInsights ?? [];
  const reportGaps =
    report?.gaps ?? fixture?.gaps ?? Object.values(task?.results ?? {}).flatMap((r) =>
      r.status === "failed" ? [] : r.gaps,
    );

  if (!loaded) return <p className="text-sm">载入中…</p>;

  if (usable.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm">还没有可用的调研结果。</p>
        <div className="flex gap-4">
          <Link href="/" className="text-sm underline underline-offset-4">
            创建任务
          </Link>
          <Link href="/report?demo=1" className="text-sm underline underline-offset-4">
            查看示例报告
          </Link>
        </div>
      </div>
    );
  }

  const goal = demo ? fixture?.goal ?? "" : task?.goal ?? "";
  const generatedAt = demo ? fixture?.generatedAt : task?.createdAt;
  const failedCount = demo
    ? (fixture?.products ?? []).filter((p) => p.status === "failed").length
    : Object.values(task?.results ?? {}).filter((r) => r.status === "failed").length;

  const allSources = usable.flatMap((p) =>
    p.sources.map((s) => ({ ...s, productName: p.name })),
  );

  return (
    <div className="space-y-10 pb-16">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">AI 客服竞品横评报告</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          调研目的：{goal}
        </p>
        {generatedAt && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            生成时间：{new Date(generatedAt).toLocaleString("zh-CN")}
          </p>
        )}

        <div className="flex flex-wrap gap-3 text-xs">
          <Link href="/" className="underline underline-offset-4" style={{ color: "var(--text-secondary)" }}>
            创建新任务
          </Link>
          <Link
            href="/report?demo=1"
            className="underline underline-offset-4"
            style={{ color: "var(--text-secondary)" }}
          >
            查看示例报告
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="no-print underline underline-offset-4"
            style={{ color: "var(--text-secondary)" }}
          >
            打印 / 导出 PDF
          </button>
        </div>
      </header>

      {/* Honesty banner: the reader must know whether this is real research. */}
      {isPlaceholder && (
        <Banner tone="warning" title="这是占位示例，不是真实调研结果">
          页面中的产品均为虚构，仅用于验证报告的渲染路径与数据结构。
          配置好 API Key 后，在首页发起一次真实调研即可得到同样的报告。
        </Banner>
      )}

      {failedCount > 0 && (
        <Banner tone="warning" title={`有 ${failedCount} 个产品调研失败`}>
          失败的产品已从对比中排除，其余产品的结论不受影响。可在调研页对失败项单独重试。
        </Banner>
      )}

      {/* 1. Scope and rules */}
      <Section index="1" title="调研范围与来源规则">
        <ul className="space-y-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          <li>· 参与对比的产品：{usable.map((p) => p.name).join("、")}</li>
          <li>· 信息仅来自下列公开网页，未使用任何未公开或内部资料。</li>
          <li>· 每条结论都标注证据等级：已核实事实（有来源可点开）、AI 推断（跨事实归纳）、待确认（资料不足或冲突）。</li>
          <li>· 公开资料查不到的维度一律标记为「未知」，不使用常识或行业经验补全。</li>
        </ul>
      </Section>

      {/* 2. Positioning cards */}
      <Section index="2" title="产品定位摘要">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {usable.map((product) => (
            <div
              key={product.name}
              className="rounded-lg border p-4"
              style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
            >
              <p className="text-sm font-medium">{product.name}</p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {product.oneLiner || "公开资料未提供一句话定位"}
              </p>
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                目标客户：{product.targetCustomer || "信息不足"}
              </p>
              {product.officialUrl && (
                <a
                  href={product.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block break-all text-xs underline underline-offset-2"
                  style={{ color: "var(--series-1)" }}
                >
                  {product.officialUrl}
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* 3. The matrix */}
      <Section index="3" title="十维能力对比矩阵">
        <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
          四个状态各自带图标与文字，不依赖颜色区分。鼠标悬停单元格可查看该维度的结论摘要与是否有证据。
        </p>
        <DimensionMatrix products={usable} />
      </Section>

      {/* 4. Coverage */}
      <Section index="4" title="证据覆盖率">
        <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
          每个产品在十个维度中，有多少个维度获得了可核实的公开信息。数值越高，说明该产品的公开资料越充分——
          这反映的是<b>信息可得性</b>，不是产品能力的强弱。
        </p>
        <CoverageChart products={usable} />
      </Section>

      {/* 5. Pricing */}
      <Section index="5" title="定价对比">
        <PricingSection products={usable} insights={byName} />
      </Section>

      {/* 6. Per-product insights */}
      <Section index="6" title="各产品优势、短板与适用用户">
        <div className="space-y-4">
          {usable.map((product) => {
            const insight = byName.get(product.name);
            return (
              <div
                key={product.name}
                className="rounded-lg border p-4"
                style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
              >
                <p className="text-sm font-medium">{product.name}</p>
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  <InsightColumn title="优势" items={insight?.strengths ?? []} />
                  <InsightColumn title="短板" items={insight?.weaknesses ?? []} />
                  <div>
                    <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      适用用户
                    </p>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      {insight?.bestFor || "信息不足"}
                    </p>
                  </div>
                </div>

                <details className="mt-4">
                  <summary className="cursor-pointer text-xs" style={{ color: "var(--text-secondary)" }}>
                    具体事实与来源（{product.claims.length} 条）
                  </summary>
                  <div className="mt-2">
                    <ClaimList claims={product.claims} sources={product.sources} />
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 7. Market insights */}
      <Section index="7" title="市场共性、差异化与潜在机会">
        <ClaimList claims={marketInsights} sources={allSources} />
      </Section>

      {/* 8. Gaps */}
      <Section index="8" title="信息缺口与待人工验证项">
        {reportGaps.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            本次未记录到明显缺口。
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {Array.from(new Set(reportGaps)).map((gap, index) => (
              <li key={index} className="flex gap-2">
                <span aria-hidden style={{ color: "var(--status-warning)" }}>
                  ◐
                </span>
                <span style={{ color: "var(--text-secondary)" }}>{gap}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 9. Sources */}
      <Section index="9" title="来源列表">
        <div className="space-y-5">
          {usable.map((product) => (
            <div key={product.name}>
              <p className="mb-2 text-sm font-medium">{product.name}</p>
              <SourceList sources={product.sources} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/**
 * Pricing gets a table unless we hold genuinely comparable numbers. A one-bar
 * bar chart is worse than a table, and inventing a number to make the chart
 * render would be worse still.
 *
 * The chart branch is unreachable in production today — the extraction contract
 * has no numeric price field, so every card comes back `modelOnly` or `unknown`.
 * It stays wired for the day the model can fill it.
 */
function PricingSection({
  products,
  insights,
}: {
  products: DoneResult[];
  insights: Map<string, ProductInsight>;
}) {
  // Carting the discriminated union through the array keeps `mode` narrowed all
  // the way into the render, instead of re-checking it at each use site.
  const priced = products.flatMap((p) => {
    const insight = insights.get(p.name);
    return insight ? [{ name: p.name, pricing: insight.pricing }] : [];
  });
  const quantified = priced.filter(isQuantified);

  if (quantified.length === priced.length && priced.length > 0) {
    return <PricingChart products={quantified} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {quantified.length === 0
          ? "没有产品公开了可直接比较的价格数字，因此以表格呈现计费方式，而不是画一张会误导人的图。"
          : `仅 ${quantified.length} 个产品公开了可比价格，不足以支撑横向比较，因此以表格呈现。`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b px-3 py-2 text-left text-xs font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                产品
              </th>
              <th
                scope="col"
                className="border-b px-3 py-2 text-left text-xs font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                计费方式
              </th>
            </tr>
          </thead>
          <tbody>
            {priced.map(({ name, pricing }) => (
              <tr key={name}>
                <td
                  className="border-b px-3 py-2 align-top text-xs"
                  style={{ borderColor: "var(--border)" }}
                >
                  {name}
                </td>
                <td
                  className="border-b px-3 py-2 align-top text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  {pricing.mode === "modelOnly" ? pricing.model : pricing.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type QuantifiedPricing = Extract<PricingInfo, { mode: "quantified" }>;

function isQuantified(
  entry: { name: string; pricing: PricingInfo },
): entry is { name: string; pricing: QuantifiedPricing } {
  return entry.pricing.mode === "quantified";
}

function PricingChart({
  products,
}: {
  products: Array<{ name: string; pricing: QuantifiedPricing }>;
}) {
  const max = Math.max(...products.map((p) => p.pricing.entryMonthly));

  return (
    <div className="space-y-3">
      {products.map(({ name, pricing }) => {
        const width = max > 0 ? (pricing.entryMonthly / max) * 100 : 0;
        return (
          <div key={name}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span>{name}</span>
              <span className="tnum" style={{ color: "var(--text-secondary)" }}>
                {pricing.currency}
                {pricing.entryMonthly} / 月起
              </span>
            </div>
            <div
              className="h-2.5 rounded-r"
              style={{ width: `${Math.max(width, 2)}%`, background: "var(--seq-450)" }}
            />
          </div>
        );
      })}
    </div>
  );
}

function InsightColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          未记录
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((item, index) => (
            <li key={index} className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              · {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Section({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
        <span className="tnum text-xs" style={{ color: "var(--text-muted)" }}>
          {index}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Banner({
  tone,
  title,
  children,
}: {
  tone: "warning" | "info";
  title: string;
  children: React.ReactNode;
}) {
  const color = tone === "warning" ? "var(--status-warning)" : "var(--series-1)";
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <span aria-hidden style={{ color }}>
          ◐
        </span>
        {title}
      </p>
      <p className="mt-1 pl-6 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {children}
      </p>
    </div>
  );
}
