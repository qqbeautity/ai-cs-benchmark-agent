"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PRODUCT_STATUS_META,
  TOTAL_DIMENSIONS,
  isDone,
  type ProductResearchResult,
  type ProductStatus,
} from "@/lib/types";
import { loadTask, saveTask, type StoredTask } from "@/lib/task-store";

export default function ResearchPage() {
  const router = useRouter();
  const [task, setTask] = useState<StoredTask | null>(null);
  // The only state that is not a function of `task`: which products this tab
  // currently has a request open for. Everything else — done, insufficient,
  // failed, and the failure message itself — is read back off the stored
  // result, so a retry that the server rejects cannot leave a stale label.
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTask(loadTask());
    setLoaded(true);
  }, []);

  const runOne = useCallback(async (specId: string) => {
    const current = loadTask();
    const spec = current?.specs.find((s) => s.id === specId);
    if (!current || !spec) return;

    setRunning((prev) => new Set(prev).add(specId));

    try {
      const res = await fetch("/api/research/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: spec.name,
          officialUrl: spec.officialUrl,
          allowThirdParty: spec.allowThirdParty,
        }),
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error ?? `请求失败（HTTP ${res.status}）`);
      }

      persistResult(specId, (await res.json()) as ProductResearchResult);
    } catch (error) {
      // Stored as a normal failed result rather than a parallel error map: the
      // list, the disabled state of the report button and the message all read
      // from one place.
      persistResult(specId, {
        status: "failed",
        error: (error as Error).message ?? "未知错误",
        retryable: true,
      });
    } finally {
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(specId);
        return next;
      });
    }
  }, []);

  function persistResult(specId: string, result: ProductResearchResult) {
    const current = loadTask();
    if (!current) return;
    const next: StoredTask = {
      ...current,
      results: { ...current.results, [specId]: result },
    };
    saveTask(next);
    setTask(next);
  }

  // Sequential rather than parallel: the free tier is rate limited, and a 429
  // storm is worse than a slower run. The documented ceiling is 2 in flight
  // (PLAN.md §3.8); one at a time leaves headroom, and raising it is a change
  // to this loop and nothing else.
  const runAll = useCallback(async () => {
    const current = loadTask();
    if (!current) return;
    for (const spec of current.specs) {
      if (loadTask()?.results[spec.id]) continue;
      await runOne(spec.id);
    }
  }, [runOne]);

  const finalized = useMemo(
    () => Boolean(task) && task!.specs.every((s) => task!.results[s.id]),
    [task],
  );

  useEffect(() => {
    if (!loaded || !task || finalized) return;
    // Kick off only if nothing is already in flight — this effect re-runs when
    // results land, and a second queue would double every request.
    if (running.size > 0) return;
    void runAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, task?.createdAt, finalized]);

  const usableCount = useMemo(
    () =>
      task ? task.specs.filter((s) => { const r = task.results[s.id]; return r && isDone(r); }).length : 0,
    [task],
  );

  if (!loaded) {
    return <p className="text-sm" style={{ color: "var(--text-muted)" }}>载入中…</p>;
  }

  if (!task) {
    return (
      <div className="space-y-3">
        <p className="text-sm">没有找到任务记录。</p>
        <Link href="/" className="text-sm underline underline-offset-4">
          返回创建任务
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">调研进行中</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          调研目的：{task.goal}
        </p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          每个产品约需 30–90 秒。为避免触发免费层限流，产品按顺序调研，一个失败不会影响其余产品。
        </p>
      </div>

      <ul className="space-y-2">
        {task.specs.map((spec, index) => {
          const result = task.results[spec.id];
          const status = productStatus(result, running.has(spec.id));
          return (
            <li
              key={spec.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
              style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  <span className="tnum mr-2" style={{ color: "var(--text-muted)" }}>
                    {index + 1}
                  </span>
                  {spec.name}
                </p>
                <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                  {spec.officialUrl ?? "未填写官网，将依赖搜索结果"}
                </p>
                {result && isDone(result) && (
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    已确认 {result.confirmedDimensions}/{TOTAL_DIMENSIONS} 个维度
                  </p>
                )}
                {result?.status === "failed" && (
                  <p className="mt-1 text-xs" style={{ color: "var(--status-critical)" }}>
                    {result.error}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <StatusChip status={status} />
                {isRetryable(result, running.has(spec.id)) && (
                  <button
                    type="button"
                    onClick={() => void runOne(spec.id)}
                    className="rounded-md border px-2.5 py-1 text-xs"
                    style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                  >
                    重试
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={usableCount === 0}
          onClick={() => router.push("/report")}
          className="rounded-md px-5 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          style={{ background: "var(--series-1)" }}
        >
          生成横评报告{usableCount > 0 ? `（${usableCount} 个产品）` : ""}
        </button>
        {!finalized && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            其余产品仍在调研中，可以先用已完成的产品生成报告
          </span>
        )}
        <Link href="/" className="text-xs underline underline-offset-4" style={{ color: "var(--text-secondary)" }}>
          重新创建任务
        </Link>
      </div>
    </div>
  );
}

function productStatus(result: ProductResearchResult | undefined, isRunning: boolean): ProductStatus {
  if (result) return result.status;
  return isRunning ? "searching" : "pending";
}

function isRetryable(result: ProductResearchResult | undefined, isRunning: boolean): boolean {
  if (isRunning) return false;
  // A missing result, or a thin one, is worth a (re)attempt — search coverage
  // varies run to run. A failed result carries the server's own judgement.
  if (!result) return true;
  if (result.status === "failed") return result.retryable;
  return result.status === "insufficient";
}

function StatusChip({ status }: { status: ProductStatus }) {
  const meta = PRODUCT_STATUS_META[status];
  return (
    <span className="state-chip">
      <span aria-hidden style={{ color: meta.color }}>
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}
