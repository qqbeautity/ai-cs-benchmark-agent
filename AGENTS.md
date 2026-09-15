<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 上方 `nextjs-agent-rules` 区块由 `next dev` 自动生成并会重新写回，因此保持英文原文，请勿翻译。

## 这是什么项目

一个求职作品集 MVP：用户输入 3–5 个 AI 客服产品，程序联网检索、按十个维度抽取能力信息，渲染出一份**每条结论都能追溯到来源**的横评报告。

项目的立论不是「让 AI 写一份报告」，而是「**让 AI 的说法可被验证**」。那些为了诚实而牺牲观感的设计决策都是刻意的，不要"顺手优化"掉。完整来龙去脉见 `PLAN.md`，面向用户的版本见 `README.md`。

## 命令

```bash
npm run dev            # 开发服务器（默认 3000 端口）
npm run build          # 生产构建
npm run typecheck      # tsc --noEmit
npm test               # 全部 vitest 用例
npx vitest run src/lib/schema.test.ts          # 只跑单个文件
npx vitest run -t "降级"                        # 按测试名跑单个用例

npm run fixture        # 用真实 API 生成 src/fixtures/shape-example.json（拒绝覆盖占位数据，除非带 --force）
npm run smoke          # 三个 Playwright 冒烟脚本 + 截图
```

注意：`npm run lint` 虽然在 `package.json` 里声明了，但**仓库中既没有 ESLint 配置也没有对应依赖**，跑起来会直接失败。请改用 `typecheck`。

`npm run smoke` 需要 dev server 已经跑在 **3111 端口**（`npx next dev -p 3111`），端口号在脚本里是硬编码的。三个脚本依次是 `smoke-home.mjs`（首页与表单校验）、`smoke.mjs`（`/report?demo=1`，浅色+深色两遍）、`smoke-live.mjs`（种入任务记录后渲染真实路径 `/report`，验证无 Key 时的降级渲染）。截图输出到 `docs/screenshots/`。

## 架构

### 客户端/服务端边界是承重结构

这是全项目最重要的一条结构规则，**违反它会让整个报告页白屏**。

- `src/lib/server-env.ts` —— 带 `import "server-only"`，存放 API Key。**任何客户端组件都不得直接或间接引用它。** `server-only` 这个包会让**构建期**直接失败，这是刻意设计的：本代码的上一版用的是运行时守卫，但生效太晚——密钥早已打进浏览器包里了。缺 Key 时 `required()` 抛 `ConfigError`，`researchProduct` 据此把结果标成 `retryable: false`（重试不会让缺失的 Key 出现）。
- `src/lib/types.ts` —— 客户端安全的公共归属地。纯类型、常量、类型守卫（`isDone`、`isQuantified`），以及**客户端和服务端共用的推导函数**：`deriveProductInsights`（产品卡片）、`describeDowngrade`、`sanitizeText`、`COVERAGE_META` / `CLAIM_META` / `PRODUCT_STATUS_META` 等展示元数据。
- `src/lib/report.ts`、`research.ts`、`gemini.ts`、`tavily.ts`、`prompts.ts` —— 因传递依赖 `server-env.ts` 而属于服务端专用。
- `src/lib/gaps.ts`、`validate-result.ts` —— 客户端安全（只依赖 `types.ts` 与 `zod`）。`gaps.ts` 是从 `research.ts` 里**抽出来**的，正是为了让信息缺口那段文案能被单元测试覆盖；`validate-result.ts` 刻意不 import `NextResponse`，保持 schema 层不依赖 HTTP 框架。

如果客户端组件需要服务端模块里的东西，**把那个东西挪到 `types.ts`**，而不是放宽边界。`isDone` 之所以住在 `types.ts`，正是这个原因。

反过来也成立：**同一份逻辑不要在两处各写一遍**。报告页曾经复制过一份服务端 `derivePricing`，两边各自演化——现在统一走 `deriveProductInsights`，服务端传模型散文、客户端不传，由同一个函数决定怎么合并。

### 来源绑定 —— 核心不变量

`src/lib/schema.ts` 是这个项目有意思的根本原因，改动抽取逻辑前请先读它。

模型**永远看不到 URL**。检索结果被编号成 `SourceRef` 的 id（`S1`、`S2`……），只有 id 会进提示词。事后由**程序而非模型**逐条校验引用：

- 某条结论引用了本次运行中不存在的 `sourceId` → 降级为 `unconfirmed`，记录 `downgradeReason` 并在界面上展示出来
- 某维度声称有能力、但没有存活下来的来源 → 强制退回 `unknown`，**并清空其摘要**（有摘要没证据，读起来就像一条已确认的事实）
- 模型写进正文里的任何 URL → 由 `types.ts` 里的 `sanitizeText` 替换为 `[链接见来源]`；页面只渲染经过校验的 `SourceRef.url`

`bindFindings` 永远按固定顺序输出全部十个维度，即使模型跳过了某些——否则各产品之间的表格列会错位。

### 数据流

```
客户端提交 → POST /api/research/product
  → Tavily 搜索（≤3 次查询，官方域名优先）
  → 来源编号化 → Gemini 结构化抽取（受 responseSchema 约束的 JSON）
  → zod 解析 → bindSources / bindFindings   ← 校验步骤
  → ProductResearchResult（以 `status` 为判别键的联合类型）
POST /api/research/report → 基于已验证结果做 Gemini 洞察归纳
```

各产品是**串行**调研的，不是并发——免费层有限流，429 风暴比慢一点更糟。`research.ts` 用的是普通 `for` 循环，前端页面也是一次只等一个产品。

### 降级是刻意设计的

- 洞察归纳失败（限流、输出格式错误、没有 Key）会退回 `types.ts` 的 `deriveProductInsights`，从已验证的 findings 里程序化地生成产品卡片。矩阵和图表都建立在已验证事实上，因此报告照常渲染。`scripts/smoke-live.mjs` 专测这条降级路径。
- `/api/research/product` **即使 `status: "failed"` 也返回 HTTP 200** —— 响应体是个判别联合类型，前端要靠它才能渲染重试按钮。非 200 只表示请求本身格式错误。
- 内置 fixture 的存在意义，是让演示在免费额度耗尽或没有 Key 时依然能跑。它**绝不能依赖网络**。

### 重试

`src/lib/retry.ts`：只对 429 和 5xx 做指数退避。永远不会成功的 4xx 不重试——重试它只是白烧限流额度。`Retry-After` 响应头优先于计算出的退避时长。测试会注入假的 `sleep`，请保持这一点，让测试跑得快。

早先这里还导出过一个没被任何应用代码调用的 `mapWithConcurrency`，已经删掉了。**串行调研是有意为之的上限策略**，不是还没顾上优化的顺序代码——不要为了"提速"顺手并发化。

## 图表与配色

图表遵循 `dataviz` skill 的调色板。设计令牌以 CSS 自定义属性形式定义在 `src/app/globals.css` —— 浅色与深色是**各自独立挑选**的色阶，不是简单反色。`coverage-chart.tsx` 在运行时通过 `getComputedStyle` 读取令牌，并在 `data-theme` 变化时重绘。

图表形式的选择不是审美问题：

- 十个维度用**热力矩阵，而非分组柱状图** —— 5×10 = 50 个比较项，而且这些值是分类状态，不是数值。
- 定价用**表格，而非柱状图** —— 多数厂商不公开可比数字，为了把图渲染出来而编一个数是不诚实的。`PricingInfo` 是个联合类型（`quantified` / `modelOnly` / `unknown`），只有 `quantified` 才会变成图表。
- 覆盖状态**绝不单靠颜色**传达 —— 每个状态都配有图标加文字标签，以便在色盲、灰度打印和 `forced-colors` 模式下依然可读。

## 测试

`src/lib/*.test.ts` 由 vitest 运行，通过 `vitest.config.ts` 把 `@/` 映射到源码根目录。所有被测模块都是客户端安全的——**`research.ts` / `gemini.ts` / `tavily.ts` 这类真正碰网络与 Key 的模块没有测试设施，这是一个真实的缺口**（所以能从服务端模块里抽出来的纯逻辑，就抽出来单测，`gaps.ts` 就是这么来的）。

`fixture.test.ts` 守护 `src/fixtures/shape-example.json`：它是本仓库最脆弱的文件——先手工撰写，跑了 `npm run fixture` 之后会变成机器生成。测试对两种状态都成立：整份文件过一次 `ReportFixtureSchema`，断言每条结论的 `sourceIds` 都能解析、每个非 unknown 的维度都带有证据，并且 `_placeholder` 标志与内容**互相印证**（占位数据必须自报家门，真实数据必须摘掉横幅）。这些测试一旦失败，**演示页面会渲染出错误内容，而不只是长得不一样**。

报告页是客户端组件——**用 `curl` 请求 dev server 只能拿到 loading 态**。验证报告内容必须用 Playwright 冒烟测试，不能用 `curl`。

## 已知状态

- 真实 API 链路（真实的 Tavily + Gemini）**尚未验证**。
- 演示当前读取的是 `src/fixtures/shape-example.json` —— 仍是**占位数据**，产品为虚构，其 `_placeholder: true` 字段驱动着「这不是真实调研」的横幅。生成器（`npm run fixture`）现在**写的就是这个文件**，所以「换挡」已经接好：跑一次真实生成，数据换掉、`_placeholder` 消失、横幅自动不显示。缺的只是一次带 Key 的实际运行。
- 免费层限制：Tavily 每月 1000 credits（一次 5 产品调研消耗 15），Gemini 约 10–30 RPM。`TAVILY_MAX_SEARCHES_PER_PRODUCT` 和 `GEMINI_MODEL` 之所以做成环境变量可配，是因为免费层的可用性会变。
- 部署目标是 **Vercel**，不是 Netlify。单个产品的链路耗时 30–90 秒；Netlify 的同步函数上限是固定的 60 秒，且任何套餐都不可调整。Vercel Hobby 允许 300 秒。两个 API 路由都已设置 `maxDuration = 300`。
- 本仓库**尚未初始化 git**（没有 `.git`）。
