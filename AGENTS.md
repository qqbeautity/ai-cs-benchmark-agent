<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 上方 `nextjs-agent-rules` 区块由 `next dev` 自动生成并会重新写回，因此保持英文原文，请勿翻译。
>
> 这份文件同时以 `AGENTS.md` 和 `CLAUDE.md` 两个名字被读取：仓库根的 `CLAUDE.md` 只有一行 `@AGENTS.md`。**正文改在这里**，改 `CLAUDE.md` 没有意义。

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

npm run fixture        # 真实跑一遍调研链路并覆盖 src/fixtures/shape-example.json（约 9 个 Tavily credits + 4 次模型调用）
npm run smoke          # 三个 Playwright 冒烟脚本 + 截图
```

注意：`npm run lint` 虽然在 `package.json` 里声明了，但**仓库中既没有 ESLint 配置也没有对应依赖**，跑起来会直接失败。请改用 `typecheck`。

`npm run fixture` 需要 dev server 已在 **3000 端口**跑着——脚本走 HTTP 调 `/api/research/*`，不直接 import 服务端模块（换端口用 `FIXTURE_BASE_URL`）。它写的就是**演示实际读取的那个文件**，而 npm script 里写死了 `--force`：所谓「拒绝覆盖手工占位数据」那道闸门只在你直接跑 `node scripts/generate-fixture.mjs` 时才存在，`npm run fixture` 会直接覆盖。真实数据一写进去 `_placeholder` 变 `false`，报告页的「这不是真实调研」横幅自动消失——这就是换挡的动作。

`npm run smoke` 需要 dev server 已经跑在 **3111 端口**（`npx next dev -p 3111`），端口号在脚本里是硬编码的。三个脚本依次是 `smoke-home.mjs`（首页与表单校验）、`smoke.mjs`（`/report?demo=1`，浅色+深色两遍）、`smoke-live.mjs`（种入任务记录后渲染真实路径 `/report`，**把洞察请求 stub 成「200 + 空洞察阶段」**，验证降级渲染）。截图输出到 `docs/screenshots/`。

## 架构

### 客户端/服务端边界是承重结构

这是全项目最重要的一条结构规则，**违反它会让整个报告页白屏**。

- `src/lib/server-env.ts` —— 带 `import "server-only"`，存放 API Key。**任何客户端组件都不得直接或间接引用它。** `server-only` 这个包会让**构建期**直接失败，这是刻意设计的：本代码的上一版用的是运行时守卫，但生效太晚——密钥早已打进浏览器包里了。缺 Key 时 `required()` 抛 `ConfigError`，`researchProduct` 据此把结果标成 `retryable: false`（重试不会让缺失的 Key 出现）。
- `src/lib/types.ts` —— 客户端安全的公共归属地。纯类型、常量、类型守卫（`isDone`、`isQuantified`），以及**客户端和服务端共用的推导函数**：`deriveProductInsights`（产品卡片）、`describeDowngrade`、`sanitizeText`、`COVERAGE_META` / `CLAIM_META` / `PRODUCT_STATUS_META` 等展示元数据。
- `src/lib/report.ts`、`research.ts`、`llm.ts`、`tavily.ts`、`prompts.ts` —— 因传递依赖 `server-env.ts` 而属于服务端专用。
- `src/lib/gaps.ts`、`validate-result.ts`、`completion.ts` —— 客户端安全（只依赖 `types.ts` / `retry.ts` 与 `zod`）。`gaps.ts` 是从 `research.ts` 里**抽出来**的，正是为了让信息缺口那段文案能被单元测试覆盖；`completion.ts` 是同样的手法用在模型层上——凡是 OpenAI 兼容线格式里纯粹的数据进/数据出（请求体构造、响应解包、JSON 提取）都在这里，因为 `llm.ts` 要 import `server-env.ts`，**在 vitest 下 import 会直接抛错**，那正是这些逻辑此前一行测试都没有的原因。`validate-result.ts` 刻意不 import `NextResponse`，保持 schema 层不依赖 HTTP 框架。

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
  → 来源编号化 → 通义千问结构化抽取（受 json_schema 约束的 JSON）
  → zod 解析 → bindSources / bindFindings   ← 校验步骤
  → ProductResearchResult（以 `status` 为判别键的联合类型）
POST /api/research/report → 基于已验证结果做模型洞察归纳
```

模型调用走的是**任何 OpenAI 兼容端点**，厂商由 `LLM_BASE_URL` / `LLM_MODEL` 决定，默认阿里云百炼（通义千问）。代码里只有一条传输层（`llm.ts`），不按厂商分叉——两套传输层会各自演化。

`LLM_JSON_MODE` 控制结构化输出的约束方式。`json_schema`（默认）让 provider 在解码层强约束结构；`json_object` 只保证是合法 JSON。**但 schema 描述在两种模式下都会进提示词**（`renderSchemaForPrompt`），这不是冗余：provider 文档对兼容端点是否真的执行 `json_schema` 说法不一，而静默降级不会报任何错——你会一直以为约束还在。两条路径行为一致，降级就只损失可靠性，不损失正确性。严格模式的模型覆盖很窄，换到不支持的模型会直接 400。

**`qwen3.8-max` 上严格模式已实测生效**（返回 200、`finish_reason: stop`、content 严格符合 schema），不是被静默降级。换模型时重新测一次。

`LLM_DISABLE_THINKING` 控制思考模式。**Qwen3.8 系列默认开着思考**，而推理 token 和正文一起计进 `completion_tokens`、一起受 `LLM_MAX_TOKENS` 约束——实测一个 5 token 的答案在不关时烧掉 50 个，其中 38 个是推理。十维抽取的输出有几千 token，不关会明显抬高截断风险，也拖慢响应、抬高费用。开关打开时 `buildChatBody` 往请求体里加 `enable_thinking: false`；**留空则完全不发这个字段**（而不是发 `false`），因为它是 Qwen/DashScope 的私有扩展，标准 OpenAI 端点可能拒绝未知字段——默认请求体必须保持可移植。也正因如此这个开关没有「默认值」：厂商默认行为取决于厂商。所以 `.env.example` 里显式设成 `1`，换到非 Qwen 模型时留空。

各产品是**串行**调研的，不是并发——上游有限流，429 风暴比慢一点更糟。`research.ts` 用的是普通 `for` 循环，前端页面也是一次只等一个产品。

### 降级是刻意设计的

- 洞察归纳失败（限流、输出格式错误、没有 Key）会退回 `types.ts` 的 `deriveProductInsights`，从已验证的 findings 里程序化地生成产品卡片。矩阵和图表都建立在已验证事实上，因此报告照常渲染。`scripts/smoke-live.mjs` 专测这条降级路径——它**用 `page.route()` 把 `/api/research/report` 打回 500**。留意这个 stub 不是多余的：在它出现之前，该脚本靠「本机没配 Key」来制造失败，而 `.env.local` 一存在这个前提就没了，请求会真的打到模型上、所有断言照样通过（它们描述的结构两种情况下都成立），降级路径就此失去覆盖而测试仍然报绿，还每次烧一次真实调用。
- `/api/research/product` **即使 `status: "failed"` 也返回 HTTP 200** —— 响应体是个判别联合类型，前端要靠它才能渲染重试按钮。非 200 只表示请求本身格式错误。
- 内置 fixture 的存在意义，是让演示在免费额度耗尽或没有 Key 时依然能跑。它**绝不能依赖网络**。

### 重试

`src/lib/retry.ts`：只对 429 和 5xx 做指数退避。永远不会成功的 4xx 不重试——重试它只是白烧限流额度。`Retry-After` 响应头优先于计算出的退避时长。测试会注入假的 `sleep`，请保持这一点，让测试跑得快。

早先这里还导出过一个没被任何应用代码调用的 `mapWithConcurrency`，已经删掉了。**串行调研是有意为之的上限策略**，不是还没顾上优化的顺序代码——不要为了"提速"顺手并发化。

## 页面与路由

三个页面（`/`、`/research`、`/report`）**全是客户端组件**，没有服务端取数。这既是 `curl` 拿不到内容的原因，也是数据必须经 localStorage 传递的原因。`layout.tsx` 是服务端组件，只管 metadata 和页头页脚。

- `/` 创建任务：校验 ≥3 个有名字的产品，为每个产品铸造 `TaskSpec.id`，`saveTask()` 后 `router.push("/research")`。
- `/research` 挂载时读 localStorage 并**自动开始跑队列**，逐个 `await` 产品；失败与成功一样存进 `results`，不另建一张错误表。
- `/report` 由 `ReportPage`（Suspense 外壳）+ `ReportView` 组成。**`useSearchParams` 必须待在 `<Suspense>` 里**，否则构建直接失败——改这个文件时不要在 `ReportView` 外面引入新的同类 hook。

数据只有一份：`localStorage` 的 `ai-cs-benchmark:last-task`（`src/lib/task-store.ts`），形状是 `StoredTask { goal, createdAt, specs, results }`，`results` 以 `spec.id` 为键。**完整报告不落盘**——5 产品 × 10 维度 × 证据数组会顶到 ~5MB 上限，所以每次访问都从已存的 `results` 重新推导。`saveTask` 吞掉 `QuotaExceededError` 并返回 `false`，`loadTask` 删掉损坏条目：持久化失败只应该降级，不该让页面崩掉。

`/report` 的分支判据是 `params.get("demo") === "1"` —— **精确字符串匹配**，写成 `?demo=true` 会走真实路径。demo 路径只读内置 fixture，**完全不碰 localStorage、不发任何请求**；真实路径从 `loadTask()` 取 `results`，再调 `/api/research/report` 补洞察。报告在**部分产品成功**时就能生成（`usableCount > 0`），按钮文案随之变化。

产品卡片用 `key={product.name}` —— 产品名重复会让 React 复用错卡片。

## 图表与配色

图表遵循 `dataviz` skill 的调色板。设计令牌以 CSS 自定义属性形式定义在 `src/app/globals.css`，浅色与深色是**各自独立挑选**的色阶，不是简单反色。

样式约定：Tailwind v4（`@import "tailwindcss"`，**仓库里没有 `tailwind.config`**），令牌是裸的 CSS 自定义属性。**布局用 Tailwind class，颜色一律内联 `style={{ ... "var(--token)" }}`** —— 代码里没有用到任何 Tailwind 颜色工具类，混用会绕过主题切换。

深色有**两个**入口：`@media (prefers-color-scheme: dark)` 下的 `:root:where(:not([data-theme="light"]))`，以及 `:root[data-theme="dark"]`。`ThemeToggle` 就是切 `data-theme` 属性，选「跟随系统」时把属性整个删掉。**新增令牌要三处都加**。`--status-*` 系列是例外——它只在 `:root` 定义一次，两个深色块里都不重定义（状态色跨主题固定），调对比度时别以为漏了。`--seq-250` / `--seq-650` / `--status-serious` / `--success-text` 目前定义了但没有任何组件在用，属于预留槽位。

`coverage-chart.tsx` 在 `useEffect` 里用 `getComputedStyle` 读令牌（`readToken`，带浅色兜底值），靠 `MutationObserver` 监听 `data-theme` 变化、外加 `matchMedia("(prefers-color-scheme: dark)")` 监听系统切换来触发重绘。ECharts 走模块化 import + 顶层 `echarts.use([...])` 注册；仓库里**没有任何 `next/dynamic` / `ssr: false`**，SSR 安全靠三件事：`echarts.init` 只在 `useEffect` 里调用、`readToken` 里的 `typeof window === "undefined"` 守卫、以及 `next.config.ts` 的 `serverExternalPackages: ["echarts"]`。

图表形式的选择不是审美问题：

- 十个维度用**热力矩阵，而非分组柱状图** —— 5×10 = 50 个比较项，而且这些值是分类状态，不是数值。
- 定价用**表格，而非柱状图** —— 多数厂商不公开可比数字，为了把图渲染出来而编一个数是不诚实的。`PricingInfo` 是个联合类型（`quantified` / `modelOnly` / `unknown`），只有全部产品都是 `quantified` 才切成图表。**这条分支目前跑不到**：内置 fixture 里只有 `modelOnly` 和 `unknown`，所以定价一律渲染成表格，这段代码也没有任何测试覆盖。
- 覆盖状态**绝不单靠颜色**传达 —— 每个状态都配有图标加文字标签，以便在色盲、灰度打印和 `forced-colors` 模式下依然可读。这条靠 `COVERAGE_META` / `CLAIM_META` / `PRODUCT_STATUS_META` 把 `{label, icon, color}` 绑成一个整体来兜底，别单独取 `color`。

`TOTAL_DIMENSIONS` 由 `DIMENSIONS.length` 推导（「已确认 X/10」和图表轴都读它），**不要硬编码 10**。

## 测试

`src/lib/*.test.ts` 由 vitest 运行，通过 `vitest.config.ts` 把 `@/` 映射到源码根目录。所有被测模块都是客户端安全的——**`research.ts` / `llm.ts` / `tavily.ts` 这类真正碰网络与 Key 的模块没有测试设施，这是一个真实的缺口**（所以能从服务端模块里抽出来的纯逻辑，就抽出来单测：`gaps.ts` 从 `research.ts` 里抽出来，`completion.ts` 从 `llm.ts` 里抽出来）。`completion.ts` 覆盖请求体构造、响应解包和 `parseModelJson`；`llm.ts` 剩下的部分（读 env + `fetch`）仍然没有测试。

`fixture.test.ts` 守护 `src/fixtures/shape-example.json`：它是本仓库最脆弱的文件——先手工撰写，跑了 `npm run fixture` 之后会变成机器生成。测试对两种状态都成立：整份文件过一次 `ReportFixtureSchema`，断言每条结论的 `sourceIds` 都能解析、每个非 unknown 的维度都带有证据，并且 `_placeholder` 标志与内容**互相印证**（占位数据必须自报家门，真实数据必须摘掉横幅）。这些测试一旦失败，**演示页面会渲染出错误内容，而不只是长得不一样**。

报告页是客户端组件——**用 `curl` 请求 dev server 只能拿到 loading 态**。验证报告内容必须用 Playwright 冒烟测试，不能用 `curl`。

## 已知状态

- **模型层已单独探通，整条链路还没跑过。** 直接打 API 验过三件事：`qwen3.8-max` 接受 `json_schema` + `strict`（不是静默降级），接受 `enable_thinking: false`，`LLM_BASE_URL` 指向的端点可达。**但「Tavily 检索 → 抽取 → 校验 → 渲染」这条端到端链路仍未验证**——那要靠一次真实的单产品调研。模型层原先接的是 Gemini，因为在中国大陆拿不到 Key 而换成了百炼——`.env.example` 里的 `LLM_BASE_URL` / `LLM_MODEL` 是唯一还记着厂商的地方，代码本身是厂商无关的。
- **`LLM_BASE_URL` 实际不是公开国内站**，而是百炼的**工作空间专属域名**（`ws-*.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`），它的 `/models` 会列出一批跨厂商模型（glm、deepseek、kimi…）。控制台给什么就填什么，不要照 `server-env.ts` 里的兜底默认值猜——区域或工作空间对不上会报 `InvalidApiKey`，而那个报错看起来像 Key 本身有问题。
- 演示当前读取的是 `src/fixtures/shape-example.json` —— 仍是**占位数据**，`_placeholder: true` 驱动着「这不是真实调研」的横幅。里面只有 3 个产品：两个虚构产品（`done`）+ 一个 `failed`，所以**多产品对比的完整效果还没在真实数据上出现过**。生成器（`npm run fixture`）写的就是这个文件，所以「换挡」已经接好：跑一次真实生成，数据换掉、`_placeholder` 消失、横幅自动不显示。缺的只是一次带 Key 的实际运行。
- 免费层限制：Tavily 每月 1000 credits（一次 5 产品调研消耗 15）；百炼按量计费、按分钟限流。`TAVILY_MAX_SEARCHES_PER_PRODUCT` 和 `LLM_MODEL` 之所以做成环境变量可配，是因为模型与额度的可用性会变。
- 严格模式的模型覆盖很窄（Qwen3.7-Plus / Qwen3.8-Flash / Qwen3.8-Max 等少数系列），换到不支持的模型会直接 400，此时设 `LLM_JSON_MODE=json_object` 即可——输出形状不变，因为 schema 两边都进提示词。
- 部署目标是 **Vercel**，不是 Netlify。单个产品的链路耗时 30–90 秒；Netlify 的同步函数上限是固定的 60 秒，且任何套餐都不可调整。Vercel Hobby 允许 300 秒。两个 API 路由都已设置 `maxDuration = 300`。
- git 已初始化，`origin` 指向 `github.com/qqbeautity/ai-cs-benchmark-agent`，目前只有初始提交一个。`npm test`（5 个文件 48 个用例）、`npm run typecheck`、`npm run build` 与 `npm run smoke`（三个脚本）都是绿的。
