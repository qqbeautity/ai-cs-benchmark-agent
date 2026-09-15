import { z } from "zod";
import {
  CLAIM_KINDS,
  COVERAGE_STATES,
  DIMENSIONS,
  sanitizeText,
  type Claim,
  type CoverageState,
  type DimensionFinding,
  type DowngradeReason,
} from "./types";

/**
 * Shape we demand from the model. Deliberately loose at the edges — the model
 * is a text generator, not a database. Everything load-bearing is validated
 * here and then re-checked by `bindSources` below.
 *
 * Keep this in lockstep with `EXTRACTION_RESPONSE_SCHEMA` in `prompts.ts`: that
 * is what constrains the model, this is what we accept. A field present in one
 * and not the other is a silent contract split — the model simply never returns
 * it, and nothing fails.
 */
export const RawDimensionSchema = z.object({
  dimension: z.enum(DIMENSIONS),
  state: z.enum(COVERAGE_STATES),
  summary: z.string().default(""),
  /** Ids into the numbered source list we handed the model. */
  sourceIds: z.array(z.string()).default([]),
});

export const RawProductSchema = z.object({
  name: z.string(),
  oneLiner: z.string().default(""),
  targetCustomer: z.string().default(""),
  dimensions: z.array(RawDimensionSchema).default([]),
  /** The only free-text the model may put a fact into. */
  claims: z
    .array(
      z.object({
        kind: z.enum(["verified", "inferred", "unconfirmed"]),
        text: z.string(),
        sourceIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export const RawExtractionSchema = z.object({
  products: z.array(RawProductSchema).default([]),
});

export type RawProduct = z.infer<typeof RawProductSchema>;

/**
 * The load-bearing step.
 *
 * Models confidently invent `sourceId`s that were never in the context. We do
 * not trust them: a claim citing an unknown id is demoted to `unconfirmed`
 * rather than shown as a verified fact. This is what makes the "每条已核实事实
 * 都有可点击来源" acceptance criterion actually hold (PLAN.md §3.5).
 */
export function bindSources(
  raw: { kind: Claim["kind"]; text: string; sourceIds: string[] },
  validSourceIds: ReadonlySet<string>,
): Claim {
  const kept = raw.sourceIds.filter((id) => validSourceIds.has(id));
  const dropped = raw.sourceIds.length - kept.length;
  const text = sanitizeText(raw.text);

  // An `inferred` claim legitimately has no sources — it is a synthesis.
  if (raw.kind === "inferred") {
    return { kind: "inferred", text, sourceIds: [] };
  }

  if (kept.length === 0) {
    const reason: DowngradeReason =
      validSourceIds.size === 0 ? "no_sources_retrieved" : "cited_source_not_found";
    return {
      kind: "unconfirmed",
      text,
      sourceIds: [],
      downgradedFrom: raw.kind,
      downgradeReason: reason,
    };
  }

  // Some ids resolved, some didn't: keep the claim but record the partial miss.
  return {
    kind: raw.kind,
    text,
    sourceIds: kept,
    ...(dropped > 0
      ? { downgradedFrom: raw.kind, downgradeReason: "cited_source_not_found" as const }
      : {}),
  };
}

export function bindFindings(
  raw: RawProduct,
  validSourceIds: ReadonlySet<string>,
): DimensionFinding[] {
  const byId = new Map(raw.dimensions.map((d) => [d.dimension, d]));

  // Always emit all ten dimensions in canonical order — a dimension the model
  // skipped is `unknown`, not a missing row that would silently shift the table.
  return DIMENSIONS.map((dimension) => {
    const found = byId.get(dimension);
    if (!found) {
      return { dimension, state: "unknown" as CoverageState, summary: "", hasEvidence: false };
    }

    const kept = found.sourceIds.filter((id) => validSourceIds.has(id));
    // `unknown` needs no evidence; any other state without a surviving source
    // is not something we are willing to assert.
    if (found.state !== "unknown" && kept.length === 0) {
      return {
        dimension,
        state: "unknown" as CoverageState,
        summary: "",
        hasEvidence: false,
      };
    }

    return {
      dimension,
      state: found.state,
      summary: sanitizeText(found.summary),
      hasEvidence: kept.length > 0,
    };
  });
}

export function countConfirmed(findings: DimensionFinding[]): number {
  return findings.filter((f) => f.state !== "unknown").length;
}

export function makeSourceId(index: number): string {
  return `S${index + 1}`;
}
