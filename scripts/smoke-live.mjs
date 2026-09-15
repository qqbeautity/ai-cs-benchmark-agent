#!/usr/bin/env node
/**
 * Browser smoke test for the *live* report path's degraded rendering.
 *
 * `smoke.mjs` covers `/report?demo=1`, which reads the bundled fixture. This one
 * seeds a stored task instead, so it exercises the path a real run takes — where
 * the product cards come from the insight request rather than the fixture. That
 * request is stubbed to return the empty insight stage a failed model call
 * produces, which is the case worth checking: the report must still render,
 * falling back to the shared derivation over the validated findings.
 *
 * The stub is deliberate, not belt-and-braces. This script used to rely on there
 * being no API keys configured, and that stopped being true the moment
 * `.env.local` existed — the request then succeeds against the real model, and
 * every assertion below still passes, because they describe structure that holds
 * either way. The degradation path would have gone untested while reporting
 * green, and `npm run smoke` would have started billing a model call per run.
 *
 *   node scripts/smoke-live.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.argv[2] || "http://localhost:3111";

const fixture = JSON.parse(await readFile(resolve(ROOT, "src/fixtures/shape-example.json"), "utf8"));
// Strip the fixture's own gap strings: with the insight stage unavailable the
// report's gap list must then come from the per-product `gaps`, which is the
// code path that used to interpolate raw dimension ids into user-facing text.
const done = fixture.products
  .filter((p) => p.status !== "failed")
  .map((p) => ({ ...p, gaps: [] }));

const task = {
  goal: "live 路径验证：洞察阶段失败时的报告页",
  createdAt: new Date("2026-09-14T08:00:00Z").toISOString(),
  specs: done.map((p, i) => ({
    id: `t_live_${i}`,
    name: p.name,
    officialUrl: p.officialUrl ?? undefined,
    allowThirdParty: true,
  })),
  results: Object.fromEntries(done.map((p, i) => [`t_live_${i}`, p])),
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [];
page.on("pageerror", (e) => failures.push(`未捕获异常：${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") failures.push(`console.error：${m.text()}`);
});

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.evaluate((t) => localStorage.setItem("ai-cs-benchmark:last-task", JSON.stringify(t)), task);

// Take the insight stage down on purpose, so the failure is the script's doing
// rather than a side effect of the machine having no keys.
//
// 200 with an empty insight stage, *not* a 5xx — that is what the real route
// returns when the model is unavailable. `buildReport` swallows insight-stage
// failures and yields `{products: [], marketInsights: [], gaps: []}` (the
// `empty` constant in report.ts), so the client never reaches its `.catch`: it
// renders a successful-but-empty report and falls back to
// `deriveProductInsights` because `products.length` is 0. A 5xx would exercise
// the client's error branch instead — a path a real model failure does not take
// — and would additionally trip the console.error check below for a reason that
// has nothing to do with the degradation under test.
await page.route("**/api/research/report", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      goal: task.goal,
      generatedAt: task.createdAt,
      products: [],
      marketInsights: [],
      gaps: [],
    }),
  }),
);

await page.goto(`${BASE}/report`, { waitUntil: "networkidle" });
await page.waitForSelector("text=十维能力对比矩阵", { timeout: 20_000 });
// Let the insight fetch fail and the fallback render settle.
await page.waitForTimeout(2500);
const body = await page.innerText("body");

for (const marker of [
  "AI 客服竞品横评报告",
  "十维能力对比矩阵",
  "证据覆盖率",
  "定价对比",
  "各产品优势、短板与适用用户",
  "市场共性、差异化与潜在机会",
  "来源列表",
]) {
  if (!body.includes(marker)) failures.push(`live 路径缺少区块：「${marker}」`);
}

// The fallback cards must come from validated findings, labelled in Chinese.
if (!body.includes("产品定位与目标客户")) failures.push("fallback 卡片未渲染维度标签");
if (body.includes("这是占位示例")) failures.push("live 路径不应显示占位横幅");

// `buildGaps` only runs inside `researchProduct`, which needs API keys, so the
// gap list here is empty regardless. Its slug-leak regression is covered by
// `src/lib/gaps.test.ts` instead — asserting it from the browser is not
// possible on this path.
const gaps = await page.locator("section", { hasText: "信息缺口与待人工验证项" }).innerText();
console.log(`  缺口区块: ${gaps.replace(/\s+/g, " ").slice(0, 80)}`);

const header = await page.locator("h1").innerText();
console.log(`  h1: ${header}`);
console.log(`  区块数: ${await page.locator("section").count()}`);
console.log(`  state-chip 数: ${await page.locator(".state-chip").count()}`);

await browser.close();

if (failures.length) {
  console.error("\n✗ live 路径检查未通过：");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("\n✓ live 路径渲染正常（洞察阶段失败时降级到程序化归纳）");
