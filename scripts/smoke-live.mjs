#!/usr/bin/env node
/**
 * Browser smoke test for the *live* report path.
 *
 * `smoke.mjs` covers `/report?demo=1`, which reads the bundled fixture. This one
 * seeds a stored task instead, so it exercises the path a real run takes — where
 * the product cards come from the insight request rather than the fixture. With
 * no API keys configured that request fails, which is exactly the case worth
 * checking: the report must still render, falling back to the shared derivation
 * over the validated findings.
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
  goal: "live 路径验证：不配置 API Key 时的报告页",
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
console.log("\n✓ live 路径渲染正常（无 API Key 时降级到程序化归纳）");
