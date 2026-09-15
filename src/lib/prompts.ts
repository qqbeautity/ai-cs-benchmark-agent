import { DIMENSIONS, DIMENSION_LABELS, type SourceRef } from "./types";

/**
 * Name the provider files the schema under. Letters, digits, `_` and `-` only,
 * max 64 chars — a name outside that set is rejected before the model is even
 * called, which reads as a mysterious 400.
 */
export const EXTRACTION_SCHEMA_NAME = "product_research";

/**
 * Constrains the model to legal dimension ids and coverage states.
 *
 * Every object level carries `additionalProperties: false` and lists all of its
 * properties in `required`: strict `json_schema` mode rejects a schema that
 * omits either. `required` is already exhaustive by design — a field the model
 * may drop is a field `bindFindings` will not see, and a dimension that never
 * arrives is indistinguishable from one the model judged irrelevant.
 *
 * This object is the single source of truth for the output shape: it is both
 * sent as `response_format` and rendered into the prompt by
 * `renderSchemaForPrompt`, so the two can never disagree.
 */
export const EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          oneLiner: { type: "string" },
          targetCustomer: { type: "string" },
          dimensions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                dimension: { type: "string", enum: [...DIMENSIONS] },
                state: {
                  type: "string",
                  enum: ["supported", "partial", "unsupported", "unknown"],
                },
                summary: { type: "string" },
                sourceIds: { type: "array", items: { type: "string" } },
              },
              required: ["dimension", "state", "summary", "sourceIds"],
              additionalProperties: false,
            },
          },
          claims: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["verified", "inferred", "unconfirmed"] },
                text: { type: "string" },
                sourceIds: { type: "array", items: { type: "string" } },
              },
              required: ["kind", "text", "sourceIds"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "oneLiner", "targetCustomer", "dimensions", "claims"],
        additionalProperties: false,
      },
    },
  },
  required: ["products"],
  additionalProperties: false,
} as const;

/**
 * The extraction system instruction. Every rule here exists because a model
 * without it will happily invent a price, a customer count, or a source.
 */
export const EXTRACTION_SYSTEM = `你是一名严谨的竞品调研分析师。你会收到一组网页摘录，必须**只**依据这些摘录填表。

绝对规则：
1. 不得使用常识、记忆或训练数据补全摘录中不存在的信息。摘录里没有的，就是没有。
2. 每一项判断都必须绑定至少一个来源编号（sourceIds），编号只能取自本次提供的来源列表。
3. 如果某项信息在摘录中找不到，state 必须填 "unknown"，summary 留空字符串，sourceIds 留空数组。
4. 企业报价、准确率、客户数量、融资额、市场份额这类数字，除非摘录中**逐字出现**，一律填 "unknown"。宁可留空，不要估算。
5. state 的判定标准：
   - "supported"：摘录明确说明该能力存在
   - "partial"：摘录说明该能力存在但有限制、需额外付费、或仅部分渠道支持
   - "unsupported"：摘录明确说明不支持，或明确指出由第三方/合作伙伴提供
   - "unknown"：摘录未提及或说法冲突
6. claims 只用于记录**具体的、可验证的事实陈述**（如具体功能名、具体价格数字、具体渠道列表），不要写评价性内容。
7. 摘录之间若互相冲突，不要选一个信，把冲突写进 claims 并标记 kind 为 "unconfirmed"。
8. 不要输出任何 URL。来源通过编号引用。

只输出 JSON，不要输出解释。`;

export function buildExtractionPrompt(
  productName: string,
  sources: SourceRef[],
  snippets: Map<string, string>,
  officialUrl: string | null,
): string {
  const lines: string[] = [
    `# 待调研产品`,
    `产品名称：${productName}`,
    officialUrl ? `官网：${officialUrl}` : `官网：未提供（请仅依据下列摘录判断）`,
    "",
    `# 网页摘录`,
  ];

  if (sources.length === 0) {
    lines.push("（无。本次未能检索到任何网页，所有维度应填 unknown。）");
  }

  for (const source of sources) {
    lines.push(
      "",
      `## [${source.id}] ${source.title}`,
      `类型：${source.tier === "official" ? "官方来源" : "第三方来源"}`,
      `抓取时间：${source.retrievedAt}`,
      "内容摘录：",
      snippets.get(source.id) ?? "（无内容）",
    );
  }

  lines.push(
    "",
    `# 任务`,
    `请针对「${productName}」，按下列十个维度逐项填表：`,
    ...DIMENSIONS.map((d, i) => `${i + 1}. ${d}（${DIMENSION_LABELS[d]}）`),
    "",
    `十个维度必须全部出现在输出中，一个都不能省略。没有证据的填 unknown。`,
  );

  return lines.join("\n");
}

export const INSIGHT_SYSTEM = `你是一名 AI 产品战略分析师。你会收到多个 AI 客服产品的结构化调研结果，请做横向比较。

规则：
1. 只能基于给定的结构化事实做归纳，不得引入外部知识。
2. "inferred" 类型用于跨产品的归纳性判断（如"多数产品都支持 X"），这类结论不需要来源编号。
3. 任何具体数字、客户名、价格，若未出现在输入中，不得写入输出。
4. 如果产品之间的信息不足以支持某个结论，明确说明"信息不足"，不要给模糊的好话。
5. 指出各产品的定位差异与取舍，而不是简单罗列功能多少。

只输出 JSON。`;

export function buildInsightPrompt(
  goal: string,
  products: Array<{
    name: string;
    oneLiner: string;
    findings: Array<{ dimension: string; state: string; summary: string }>;
    gaps: string[];
  }>,
): string {
  return [
    `# 调研目的`,
    goal,
    "",
    `# 各产品结构化调研结果`,
    JSON.stringify(products, null, 2),
    "",
    `# 任务`,
    `请输出横向比较结论，包含：`,
    `- 每个产品的优势、短板、最适合的用户类型`,
    `- 市场共性（多数产品都具备什么）`,
    `- 差异化点（谁在哪方面明显不同）`,
    `- 潜在机会（现有产品都做得不好的地方）`,
    `- 整体信息缺口（哪些关键问题公开资料无法回答）`,
  ].join("\n");
}
