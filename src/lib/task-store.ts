"use client";

import type { ProductResearchRequest, ProductResearchResult } from "./types";

const KEY = "ai-cs-benchmark:last-task";

export interface TaskSpec extends ProductResearchRequest {
  id: string;
}

export interface StoredTask {
  goal: string;
  createdAt: string;
  specs: TaskSpec[];
  /** Research results, keyed by task id. Absent until a product completes. */
  results: Record<string, ProductResearchResult>;
}

/**
 * Only task metadata and per-product results live here.
 *
 * The full report is NOT persisted: five products x ten dimensions x evidence
 * arrays comfortably exceeds the ~5MB localStorage ceiling, which is why v1's
 * "refresh restores the last result" criterion could not pass
 * (PLAN.md §3.7b). Reports are re-derived from `results`, and the sample
 * report comes from the bundled fixture instead.
 */
export function loadTask(): StoredTask | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTask;
    if (!parsed?.specs?.length) return null;
    return parsed;
  } catch {
    // A corrupt entry must not brick the landing page — drop it and move on.
    window.localStorage.removeItem(KEY);
    return null;
  }
}

export function saveTask(task: StoredTask): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(task));
    return true;
  } catch (error) {
    // QuotaExceededError is expected once results fill up. The UI keeps its
    // in-memory copy, so losing persistence here degrades rather than breaks.
    console.warn("无法保存任务到 localStorage：", error);
    return false;
  }
}

export function makeTaskId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
