import { describe, expect, it } from "vitest";
import { buildGaps } from "./gaps";
import { DIMENSION_LABELS, DIMENSIONS, type DimensionFinding, type SourceRef } from "./types";

const finding = (dimension: DimensionFinding["dimension"], state: DimensionFinding["state"]): DimensionFinding => ({
  dimension,
  state,
  summary: "",
  hasEvidence: state !== "unknown",
});

const source = (id: string, tier: SourceRef["tier"]): SourceRef => ({
  id,
  title: `来源 ${id}`,
  url: `https://example.com/${id}`,
  retrievedAt: "2026-09-14",
  tier,
});

describe("buildGaps", () => {
  it("names unknown dimensions with their Chinese labels, never their ids", () => {
    // The regression this module was extracted to pin down: these strings go
    // straight to the reader, and the raw ids are internal.
    const gaps = buildGaps(
      [finding("integrations", "unknown"), finding("security", "unknown")],
      [source("S1", "official")],
      0,
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain(DIMENSION_LABELS.integrations);
    expect(gaps[0]).toContain(DIMENSION_LABELS.security);

    for (const dimension of DIMENSIONS) {
      expect(gaps[0]).not.toContain(dimension);
    }
  });

  it("says nothing about gaps when every dimension was confirmed", () => {
    const gaps = buildGaps([finding("aiBot", "supported")], [source("S1", "official")], 0);

    expect(gaps).toEqual([]);
  });

  it("flags a run whose sources are all third-party", () => {
    const gaps = buildGaps(
      [finding("aiBot", "supported")],
      [source("S1", "thirdParty"), source("S2", "thirdParty")],
      0,
    );

    expect(gaps.some((g) => g.includes("第三方"))).toBe(true);
  });

  it("does not claim all sources are third-party when there are none at all", () => {
    // `every` is vacuously true on an empty array, which would have asserted
    // "全部结论来自第三方页面" about a run that produced no conclusions.
    const gaps = buildGaps([finding("aiBot", "unknown")], [], 0);

    expect(gaps.some((g) => g.includes("第三方"))).toBe(false);
  });

  it("reports how many claims were downgraded by source validation", () => {
    const gaps = buildGaps([finding("aiBot", "supported")], [source("S1", "official")], 3);

    expect(gaps.some((g) => g.includes("3 条结论"))).toBe(true);
  });
});
