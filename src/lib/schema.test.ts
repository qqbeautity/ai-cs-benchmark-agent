import { describe, expect, it } from "vitest";
import { bindFindings, bindSources, countConfirmed, type RawProduct } from "./schema";
import { DIMENSIONS, sanitizeText } from "./types";

const SOURCES = new Set(["S1", "S2"]);

describe("bindSources", () => {
  it("keeps a verified claim whose source id exists", () => {
    const claim = bindSources(
      { kind: "verified", text: "官网列出三个接入渠道。", sourceIds: ["S1"] },
      SOURCES,
    );

    expect(claim.kind).toBe("verified");
    expect(claim.sourceIds).toEqual(["S1"]);
    expect(claim.downgradedFrom).toBeUndefined();
  });

  it("demotes a claim citing a source id the model invented", () => {
    // The whole point of this module: a model-invented id must never reach the
    // report as a verified fact.
    const claim = bindSources(
      { kind: "verified", text: "准确率 92%。", sourceIds: ["S99"] },
      SOURCES,
    );

    expect(claim.kind).toBe("unconfirmed");
    expect(claim.sourceIds).toEqual([]);
    expect(claim.downgradedFrom).toBe("verified");
    expect(claim.downgradeReason).toBe("cited_source_not_found");
  });

  it("distinguishes 'no sources retrieved' from 'invented a source'", () => {
    const claim = bindSources(
      { kind: "verified", text: "某功能存在。", sourceIds: [] },
      new Set(),
    );

    expect(claim.kind).toBe("unconfirmed");
    expect(claim.downgradeReason).toBe("no_sources_retrieved");
  });

  it("keeps the surviving sources when only some ids resolve", () => {
    const claim = bindSources(
      { kind: "verified", text: "混合引用。", sourceIds: ["S1", "S99"] },
      SOURCES,
    );

    expect(claim.kind).toBe("verified");
    expect(claim.sourceIds).toEqual(["S1"]);
    // Partial miss is still recorded so the reader can see the claim was shaky.
    expect(claim.downgradeReason).toBe("cited_source_not_found");
  });

  it("leaves inferred claims source-free — they are a synthesis, not a fact", () => {
    const claim = bindSources(
      { kind: "inferred", text: "多数产品支持 X。", sourceIds: ["S1"] },
      SOURCES,
    );

    expect(claim.kind).toBe("inferred");
    expect(claim.sourceIds).toEqual([]);
  });

  it("strips URLs the model wrote into prose", () => {
    const claim = bindSources(
      { kind: "inferred", text: "参见 https://evil.example.com/x 了解更多", sourceIds: [] },
      SOURCES,
    );

    expect(claim.text).not.toContain("evil.example.com");
  });
});

describe("sanitizeText", () => {
  it("neutralises http, https and bare www links", () => {
    expect(sanitizeText("见 http://a.com 和 www.b.com")).not.toMatch(/a\.com|b\.com/);
  });

  it("leaves ordinary prose untouched", () => {
    expect(sanitizeText("支持网页与 App 渠道。")).toBe("支持网页与 App 渠道。");
  });
});

describe("bindFindings", () => {
  /** Builds a complete RawProduct so the tests exercise the real shape. */
  const raw = (dimensions: RawProduct["dimensions"]): RawProduct => ({
    name: "X",
    oneLiner: "",
    targetCustomer: "",
    dimensions,
    claims: [],
  });

  /** A dimension entry with the fields these tests do not care about filled in. */
  const dim = (
    dimension: RawProduct["dimensions"][number]["dimension"],
    state: RawProduct["dimensions"][number]["state"],
    summary: string,
    sourceIds: string[],
  ): RawProduct["dimensions"][number] => ({ dimension, state, summary, sourceIds });

  it("always emits all ten dimensions, even when the model skipped some", () => {
    const findings = bindFindings(raw([]), SOURCES);

    expect(findings).toHaveLength(DIMENSIONS.length);
    expect(findings.every((f) => f.state === "unknown")).toBe(true);
    // Canonical order keeps table columns from shifting between products.
    expect(findings.map((f) => f.dimension)).toEqual([...DIMENSIONS]);
  });

  it("downgrades a positive state to unknown when no source survives", () => {
    const findings = bindFindings(
      raw([dim("aiBot", "supported", "支持多轮对话", ["S99"])]),
      SOURCES,
    );

    const cell = findings.find((f) => f.dimension === "aiBot")!;
    expect(cell.state).toBe("unknown");
    expect(cell.hasEvidence).toBe(false);
    // A summary without evidence would read as a confirmed claim.
    expect(cell.summary).toBe("");
  });

  it("keeps a positive state when the source resolves", () => {
    const findings = bindFindings(
      raw([dim("aiBot", "supported", "支持多轮对话", ["S1"])]),
      SOURCES,
    );

    const cell = findings.find((f) => f.dimension === "aiBot")!;
    expect(cell.state).toBe("supported");
    expect(cell.hasEvidence).toBe(true);
  });

  it("allows unknown with no sources — absence of evidence is the expected shape", () => {
    const findings = bindFindings(
      raw([dim("security", "unknown", "", [])]),
      SOURCES,
    );

    expect(findings.find((f) => f.dimension === "security")!.state).toBe("unknown");
  });

  it("counts only non-unknown dimensions as confirmed", () => {
    const findings = bindFindings(
      raw([
        dim("aiBot", "supported", "x", ["S1"]),
        dim("channels", "partial", "y", ["S2"]),
        dim("security", "unknown", "", []),
      ]),
      SOURCES,
    );

    expect(countConfirmed(findings)).toBe(2);
  });
});
