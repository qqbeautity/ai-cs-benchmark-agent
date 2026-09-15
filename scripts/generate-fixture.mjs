#!/usr/bin/env node
/**
 * Runs the real research pipeline over a fixed product set and overwrites the
 * bundled demo fixture with the result.
 *
 * The fixture is what makes the demo survive an exhausted free tier, so it must
 * be produced by an actual run — not hand-written. Re-run this whenever the
 * prompt or schema changes.
 *
 * Costs real credits: 3 products × 3 searches = 9 Tavily credits plus 4 model
 * calls, several minutes of wall clock. It writes over the file the demo reads,
 * which by default holds hand-authored placeholder data — so it refuses to run
 * without --force rather than silently destroying it.
 *
 *   node --env-file=.env.local scripts/generate-fixture.mjs --force
 *
 * The dev server must be running (it is what serves the routes below).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** The file `src/lib/fixture.ts` imports. There is only one. */
const OUT_PATH = resolve(ROOT, "src/fixtures/shape-example.json");

const PRODUCTS = [
  { name: "Intercom Fin", officialUrl: "https://www.intercom.com/fin" },
  { name: "Zendesk AI", officialUrl: "https://www.zendesk.com/service/ai/" },
  { name: "Tidio Lyro", officialUrl: "https://www.tidio.com/lyro/" },
];

const GOAL = "AI 客服产品选型与市场机会分析";

async function main() {
  if (!process.env.TAVILY_API_KEY || !process.env.GEMINI_API_KEY) {
    console.error(
      "缺少 TAVILY_API_KEY / GEMINI_API_KEY。\n" +
        "请复制 .env.example 为 .env.local 并填写后重试：\n" +
        "  node --env-file=.env.local scripts/generate-fixture.mjs --force",
    );
    process.exit(1);
  }

  if (!process.argv.includes("--force")) {
    const existing = await readFile(OUT_PATH, "utf8").catch(() => "");
    if (existing.includes('"_placeholder": true')) {
      console.error(
        `${OUT_PATH}\n` +
          "当前是手工编写的占位示例。本脚本会真实抓取并覆盖它，消耗约 9 个 Tavily credits。\n" +
          "确认要覆盖请加 --force。",
      );
      process.exit(1);
    }
  }

  const base = process.env.FIXTURE_BASE_URL || "http://localhost:3000";

  // Collect the validated per-product results first; the report stage then
  // derives the insight cards from exactly those results, which is why the two
  // calls happen in this order rather than in parallel.
  const results = [];
  for (const product of PRODUCTS) {
    console.log(`\n>>> ${product.name}`);
    const res = await fetch(`${base}/api/research/product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...product, allowThirdParty: true }),
    });
    if (!res.ok) {
      console.error(`  失败：HTTP ${res.status} ${await res.text()}`);
      continue;
    }
    const json = await res.json();
    console.log(`  状态：${json.status}  已确认维度：${json.confirmedDimensions ?? 0}/10`);
    results.push(json);
  }

  const usable = results.filter((r) => r.status === "done" || r.status === "insufficient");
  if (usable.length === 0) {
    console.error("\n没有任何产品调研成功，未写出 fixture。");
    process.exit(1);
  }

  console.log(`\n>>> 生成横评洞察（${usable.length} 个产品）`);
  const reportRes = await fetch(`${base}/api/research/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: GOAL, results }),
  });
  if (!reportRes.ok) {
    console.error(`  洞察生成失败：HTTP ${reportRes.status} ${await reportRes.text()}`);
    process.exit(1);
  }
  const report = await reportRes.json();

  // Shape the file as `ReportFixture` — the report's own product cards are
  // dropped in favour of an `insights` map, because the page derives pricing
  // from the validated findings and only takes prose from the insight stage.
  const insights = Object.fromEntries(
    report.products.map(({ name, ...rest }) => [name, rest]),
  );

  const payload = {
    _placeholder: false,
    _note:
      "由 scripts/generate-fixture.mjs 真实抓取生成，产品与来源均为真实公开信息。",
    goal: GOAL,
    generatedAt: report.generatedAt ?? new Date().toISOString(),
    products: results,
    insights,
    marketInsights: report.marketInsights ?? [],
    gaps: report.gaps ?? [],
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const failed = results.length - usable.length;
  console.log(
    `\n已写入 ${OUT_PATH}\n` +
      `  ${usable.length} 个产品可用${failed > 0 ? `，${failed} 个失败` : ""}；` +
      `${Object.keys(insights).length} 份产品洞察，${payload.marketInsights.length} 条市场结论。\n` +
      `  重新运行 npm test 以确认结构与 fixture.test.ts 的断言一致。`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
