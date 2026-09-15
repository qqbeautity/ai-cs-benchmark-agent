"use client";

import { CLAIM_META, describeDowngrade, type Claim, type SourceRef } from "@/lib/types";

export function ClaimList({
  claims,
  sources,
}: {
  claims: Claim[];
  sources: SourceRef[];
}) {
  // After the guard: on the report page this renders once with an empty claim
  // list before the insight request resolves, and the map would be discarded.
  if (claims.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        本次未产出可列出的具体事实。
      </p>
    );
  }

  const byId = new Map(sources.map((s) => [s.id, s]));

  return (
    <ul className="space-y-2">
      {claims.map((claim, index) => {
        const meta = CLAIM_META[claim.kind];
        return (
          <li key={index} className="text-sm leading-relaxed">
            <span className="state-chip mr-2 align-middle">
              <span aria-hidden style={{ color: meta.color }}>
                {meta.icon}
              </span>
              {meta.label}
            </span>
            <span>{claim.text}</span>

            {claim.sourceIds.length > 0 && (
              <span className="ml-1 inline-flex gap-1 align-middle">
                {claim.sourceIds.map((id) => {
                  const source = byId.get(id);
                  if (!source) return null;
                  return (
                    <a
                      key={id}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tnum rounded border px-1.5 py-0.5 text-xs no-underline hover:underline"
                      style={{ borderColor: "var(--border)", color: "var(--series-1)" }}
                      title={source.title}
                    >
                      [{id}]
                    </a>
                  );
                })}
              </span>
            )}

            {/* Demotions are surfaced, not swallowed — the reader needs to know
                that a claim *looked* verified and failed validation. */}
            {claim.downgradedFrom && (
              <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                （{describeDowngrade(claim.downgradeReason)}）
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        未检索到来源。
      </p>
    );
  }

  return (
    <ol className="space-y-1.5 text-xs">
      {sources.map((source) => (
        <li key={source.id} className="flex gap-2">
          <span className="tnum shrink-0" style={{ color: "var(--text-muted)" }}>
            [{source.id}]
          </span>
          <span className="min-w-0">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline underline-offset-2"
              style={{ color: "var(--series-1)" }}
            >
              {source.title}
            </a>
            <span className="ml-1.5" style={{ color: "var(--text-muted)" }}>
              {source.tier === "official" ? "官方" : "第三方"} · 抓取于 {source.retrievedAt}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
