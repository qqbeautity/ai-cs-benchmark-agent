#!/usr/bin/env node
/** Smoke-checks the create-task page and the research page (empty-state path). */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:3111";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
});

console.log(">>> /");
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const home = await page.innerText("body");
for (const marker of ["AI 客服竞品横评 Agent", "调研目的", "查看示例报告（无需 API Key）", "开始调研"]) {
  if (!home.includes(marker)) errors.push(`首页缺少：「${marker}」`);
}
console.log(`    产品输入框：${await page.locator('input[aria-label*="名称"]').count()}`);

// Validation must block fewer than three products.
await page.click('button[type="submit"]');
await page.waitForTimeout(500);
const alert = await page.locator('[role="alert"]').count();
if (alert === 0) errors.push("少于 3 个产品时未显示校验提示");
else console.log(`    校验提示：${await page.locator('[role="alert"]').first().innerText()}`);

console.log(">>> /research (无任务时的空状态)");
await page.goto(`${BASE}/research`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const research = await page.innerText("body");
if (!research.includes("没有找到任务记录")) errors.push("调研页空状态未正确显示");
else console.log("    空状态正常");

await browser.close();

if (errors.length) {
  console.error("\n✗ 未通过：");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("\n✓ 首页与调研页冒烟测试通过");
