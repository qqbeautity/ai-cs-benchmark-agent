"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadTask, makeTaskId, saveTask, type TaskSpec } from "@/lib/task-store";

const DEFAULT_GOAL = "AI 客服产品选型与市场机会分析";

interface Row {
  name: string;
  officialUrl: string;
}

const EMPTY_ROWS: Row[] = [
  { name: "", officialUrl: "" },
  { name: "", officialUrl: "" },
  { name: "", officialUrl: "" },
];

export default function HomePage() {
  const router = useRouter();
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [rows, setRows] = useState<Row[]>(EMPTY_ROWS);
  const [allowThirdParty, setAllowThirdParty] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPrevious, setHasPrevious] = useState(false);

  useEffect(() => {
    setHasPrevious(Boolean(loadTask()?.specs.length));
  }, []);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    if (rows.length >= 5) return;
    setRows((prev) => [...prev, { name: "", officialUrl: "" }]);
  }

  function removeRow(index: number) {
    if (rows.length <= 3) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const filled = rows.filter((r) => r.name.trim());
    if (filled.length < 3) {
      setError("至少需要填写 3 个产品名称");
      return;
    }

    // Third-party sourcing defaults ON: without it, a product with no official
    // URL can never be researched at all (PLAN.md §3.7a).
    const specs: TaskSpec[] = filled.map((row) => ({
      id: makeTaskId(),
      name: row.name.trim(),
      officialUrl: row.officialUrl.trim() || undefined,
      allowThirdParty,
    }));

    saveTask({
      goal: goal.trim() || DEFAULT_GOAL,
      createdAt: new Date().toISOString(),
      specs,
      results: {},
    });

    router.push("/research");
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">AI 客服竞品横评 Agent</h1>
        <p className="max-w-3xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          输入 3–5 个 AI 客服产品，系统会联网检索官方与第三方资料，按十个维度抽取能力信息，
          生成一份带证据来源、对比矩阵与 AI 洞察的横评报告。
          每条结论都会标注是「已核实事实」「AI 推断」还是「待确认」——公开资料查不到的信息会明确标为「未知」，不会用常识补全。
        </p>
      </section>

      {/* The demo path must be the most obvious thing on the page: it works
          with no API key and no network calls (PLAN.md §3.6). */}
      <Link
        href="/report?demo=1"
        className="flex items-center justify-between gap-4 rounded-lg border px-5 py-4 transition-colors hover:opacity-90"
        style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
      >
        <div>
          <p className="text-sm font-medium">查看示例报告（无需 API Key）</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            直接读取预置调研结果，不发起任何联网请求，用于快速了解报告形态
          </p>
        </div>
        <span aria-hidden className="text-lg" style={{ color: "var(--text-muted)" }}>
          →
        </span>
      </Link>

      {hasPrevious && (
        <Link
          href="/research"
          className="block text-xs underline underline-offset-4"
          style={{ color: "var(--text-secondary)" }}
        >
          继续上次未完成的任务
        </Link>
      )}

      <form onSubmit={submit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="goal" className="block text-sm font-medium">
            调研目的
          </label>
          <input
            id="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={200}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
            style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">竞品产品（3–5 个）</legend>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            官网地址可选但强烈建议填写——填写后可以优先抓取官方页面，结论可信度更高。
          </p>

          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`产品 ${index + 1} 名称`}
                  value={row.name}
                  onChange={(e) => updateRow(index, { name: e.target.value })}
                  placeholder={`产品 ${index + 1} 名称`}
                  maxLength={80}
                  className="min-w-[12rem] flex-1 rounded-md border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
                />
                <input
                  aria-label={`产品 ${index + 1} 官网地址`}
                  value={row.officialUrl}
                  onChange={(e) => updateRow(index, { officialUrl: e.target.value })}
                  placeholder="官网地址（可选）"
                  maxLength={300}
                  className="min-w-[14rem] flex-1 rounded-md border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
                />
                {rows.length > 3 && (
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="rounded-md border px-2 py-2 text-xs"
                    style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                    aria-label={`删除产品 ${index + 1}`}
                  >
                    删除
                  </button>
                )}
              </div>
            ))}
          </div>

          {rows.length < 5 && (
            <button
              type="button"
              onClick={addRow}
              className="rounded-md border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              + 添加产品（最多 5 个）
            </button>
          )}
        </fieldset>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowThirdParty}
              onChange={(e) => setAllowThirdParty(e.target.checked)}
            />
            允许引用第三方来源
          </label>
          <p className="pl-6 text-xs" style={{ color: "var(--text-muted)" }}>
            默认开启。关闭后只采信官网页面——此时未填官网的产品将无法获取任何资料。
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          className="rounded-md px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--series-1)" }}
        >
          开始调研
        </button>
      </form>
    </div>
  );
}
