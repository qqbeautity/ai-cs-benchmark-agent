import { describe, expect, it } from "vitest";
import { buildChatBody, parseModelJson, readCompletion, type JsonSchemaSpec } from "./completion";

const spec: JsonSchemaSpec = {
  name: "product_research",
  schema: {
    type: "object",
    properties: { products: { type: "array", items: { type: "string" } } },
    required: ["products"],
    additionalProperties: false,
  },
};

const request = {
  systemInstruction: "你是一名严谨的竞品调研分析师。只输出 JSON。",
  userContent: "# 待调研产品\n产品名称：Intercom Fin",
};

/** `buildChatBody` returns a loose record so the transport can spread into it. */
function body(
  schema: JsonSchemaSpec | undefined,
  jsonMode: "json_schema" | "json_object",
  disableThinking = false,
) {
  return buildChatBody(
    { ...request, schema },
    { model: "qwen-plus", jsonMode, disableThinking },
  ) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    max_tokens: number;
    response_format: Record<string, unknown>;
    enable_thinking?: boolean;
  };
}

describe("buildChatBody", () => {
  it("emits a strict json_schema response_format when the provider supports it", () => {
    const built = body(spec, "json_schema");

    expect(built.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "product_research", strict: true, schema: spec.schema },
    });
    expect(built.model).toBe("qwen-plus");
    expect(built.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("still puts the schema in the prompt under json_schema mode", () => {
    // The redundancy is the point: provider docs disagree about whether the
    // compatible endpoints honour json_schema or silently downgrade it. If the
    // two paths diverge, a silent downgrade costs reliability we did not agree
    // to give up.
    const built = body(spec, "json_schema");

    // The schema *body*, not its name — `product_research` is a provider-side
    // identifier the model never needs to see.
    expect(built.messages[0].content).toContain('"additionalProperties": false');
    expect(built.messages[0].content).toContain('"products"');
    expect(built.messages[0].content).toContain("你是一名严谨的竞品调研分析师");
  });

  it("falls back to json_object but keeps the schema in the prompt", () => {
    const built = body(spec, "json_object");

    expect(built.response_format).toEqual({ type: "json_object" });
    expect(built.messages[0].content).toContain('"additionalProperties": false');
  });

  it("sends json_object and leaves the instruction alone when there is no schema", () => {
    // The insight stage: it takes whatever prose shape it gets and validates
    // downstream, so there is no schema to render — but json_object still
    // raises the odds of parseable output.
    const built = body(undefined, "json_schema");

    expect(built.response_format).toEqual({ type: "json_object" });
    expect(built.messages[0].content).toBe(request.systemInstruction);
  });

  it("omits the thinking switch entirely unless it was asked for", () => {
    // `enable_thinking` is a Qwen/DashScope extension. Sending it as `false`
    // unconditionally would put a vendor-specific key in every request and
    // break the portability that having a single transport layer is for.
    expect(body(spec, "json_schema")).not.toHaveProperty("enable_thinking");
  });

  it("turns the reasoning phase off without touching the schema constraint", () => {
    // Measured on qwen3.8-max: this took a five-token answer from 50
    // completion tokens down to 5. Reasoning lands in `completion_tokens`
    // alongside the answer, so it competes with the JSON for `max_tokens`.
    const built = body(spec, "json_schema", true);

    expect(built.enable_thinking).toBe(false);
    expect(built.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "product_research", strict: true, schema: spec.schema },
    });
  });
});

describe("readCompletion", () => {
  it("returns the assistant text", () => {
    const text = readCompletion({
      choices: [{ message: { content: '{"products":[]}' }, finish_reason: "stop" }],
    });

    expect(text).toBe('{"products":[]}');
  });

  it("names truncation instead of letting it surface as a JSON parse error", () => {
    // The regression this pins: without the finish_reason check, running out of
    // tokens reports "模型输出不是合法 JSON", which sends you debugging the
    // prompt when the actual fix is a bigger max_tokens.
    expect(() =>
      readCompletion({
        choices: [{ message: { content: '{"products":[{"name":"Int' }, finish_reason: "length" }],
      }),
    ).toThrow(/LLM_MAX_TOKENS/);
  });

  it("reports a safety block as non-retryable", () => {
    expect(() =>
      readCompletion({ choices: [{ message: {}, finish_reason: "content_filter" }] }),
    ).toThrow(/安全策略/);
  });

  it("throws rather than returning an empty string", () => {
    // An empty string would flow into parseModelJson, fail there, and report a
    // parse error for what is really an upstream problem.
    expect(() => readCompletion({ choices: [{ message: { content: "   " } }] })).toThrow(
      /空内容/,
    );
    expect(() => readCompletion({ choices: [{}] })).toThrow(/空内容/);
  });

  it("surfaces the provider's own error message when there are no choices", () => {
    expect(() =>
      readCompletion({ error: { message: "Model not found: qwen-nope" } }),
    ).toThrow(/qwen-nope/);
  });
});

describe("parseModelJson", () => {
  it("parses clean JSON", () => {
    expect(parseModelJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips a fenced ```json block", () => {
    expect(parseModelJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("recovers JSON wrapped in prose", () => {
    expect(parseModelJson<{ a: number }>('好的，结果如下：\n{"a":1}\n希望有帮助。')).toEqual({
      a: 1,
    });
  });

  it("reports the raw text when it cannot recover", () => {
    // The raw text is in the message on purpose: a bare "invalid JSON" would
    // send you to the wrong place.
    expect(() => parseModelJson("抱歉，我无法完成该请求。")).toThrow(/抱歉，我无法完成该请求/);
  });
});
