#!/usr/bin/env node
/**
 * Browser smoke test + screenshot capture.
 *
 * The report page is a client component, so its content only exists after
 * hydration — curling the dev server just returns the loading state. This
 * renders it for real and saves the screenshots used in the portfolio write-up.
 *
 *   node scripts/smoke.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.argv[2] || "http://localhost:3111";
const OUT = resolve(ROOT, "docs/screenshots");

const EXPECTED_ON_REPORT = [
  "AI 客服竞品横评报告",
  "十维能力对比矩阵",
  "证据覆盖率",
  "定价对比",
  "市场共性、差异化与潜在机会",
  "信息缺口与待人工验证项",
  "来源列表",
];

/**
 * Anything here reaching the DOM means a key leaked into the bundle.
 *
 * Both patterns that used to live here had gone stale. `AIza…` is Gemini, which
 * this project no longer calls; worse, `/tvly-[0-9A-Za-z]{10,}/` never matched a
 * real Tavily key, because the `-` in `tvly-dev-…` breaks the run of
 * alphanumerics three characters in. The net was open for the one format it was
 * written for.
 *
 * There is deliberately no generic `sk-` pattern: DashScope keys interleave `.`
 * and `-`, so any pattern loose enough to catch them also catches hyphenated
 * English prose (`sk-averse-decision-making`). EXACT_SECRETS below covers the
 * key that is actually configured, with no false positives at all.
 */
const SECRET_PATTERNS = [/tvly-[A-Za-z0-9._-]{16,}/, /AIza[0-9A-Za-z_-]{20,}/];

/**
 * The keys this run was configured with, checked literally. A leak is by
 * definition one of *these* strings showing up in the page, and comparing
 * against the exact value cannot produce a false alarm. Loaded here rather than
 * via `node --env-file` so the check works no matter how the script was started.
 */
const EXACT_SECRETS = (() => {
  try {
    process.loadEnvFile(resolve(ROOT, ".env.local"));
  } catch {
    // No .env.local — nothing configured, nothing to compare against.
  }
  return ["TAVILY_API_KEY", "LLM_API_KEY"]
    .map((name) => ({ name, value: process.env[name] }))
    .filter((s) => typeof s.value === "string" && s.value.length >= 12);
})();

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const failures = [];

  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: scheme,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`  [console.error] ${msg.text()}`);
    });
    page.on("pageerror", (err) => failures.push(`未捕获异常：${err.message}`));

    console.log(`\n>>> 首页 (${scheme})`);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.screenshot({ path: resolve(OUT, `01-home-${scheme}.png`), fullPage: true });

    console.log(`>>> 报告页 /report?demo=1 (${scheme})`);
    await page.goto(`${BASE}/report?demo=1`, { waitUntil: "networkidle" });
    // The fixture is imported synchronously; wait for the first heading rather
    // than a fixed timeout so a slow machine does not produce a false pass.
    await page.waitForSelector("text=十维能力对比矩阵", { timeout: 15_000 });

    const body = await page.innerText("body");

    for (const marker of EXPECTED_ON_REPORT) {
      if (!body.includes(marker)) failures.push(`报告页缺少区块：「${marker}」（${scheme}）`);
    }

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(body)) failures.push(`页面正文中出现疑似密钥：${pattern}（${scheme}）`);
    }
    // Never echo the value itself — a failure message quoting the key would
    // put it in the console output this check exists to keep it out of.
    for (const { name, value } of EXACT_SECRETS) {
      if (body.includes(value)) {
        failures.push(`页面正文中出现了 ${name} 的完整值（${scheme}）`);
      }
    }

    // The matrix must not rely on colour alone.
    const chipCount = await page.locator(".state-chip").count();
    if (chipCount < 10) failures.push(`状态标签数量异常：${chipCount}（${scheme}）`);

    const canvasCount = await page.locator("canvas").count();
    if (canvasCount < 1) failures.push(`覆盖率图表未渲染（${scheme}）`);

    await page.screenshot({ path: resolve(OUT, `02-report-${scheme}.png`), fullPage: true });

    // A full-page shot of a long report is hard to read; capture the top too.
    await page.screenshot({
      path: resolve(OUT, `03-report-top-${scheme}.png`),
      clip: { x: 0, y: 0, width: 1440, height: 1000 },
    });

    await context.close();
  }

  // The dev server serves the source map-free bundle, but the real leak check
  // is the production build; this at least catches obvious inline mistakes.
  const bundleResponse = await (await fetch(`${BASE}/report?demo=1`)).text();
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(bundleResponse)) failures.push(`服务端 HTML 中出现疑似密钥：${pattern}`);
  }

  await browser.close();

  if (failures.length > 0) {
    console.error("\n✗ 冒烟测试未通过：");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(`\n✓ 冒烟测试通过，截图已保存到 ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
