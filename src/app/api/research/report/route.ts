import { NextResponse } from "next/server";
import { z } from "zod";
import { buildReport } from "@/lib/report";
import { ProductResearchResultSchema, collectSourceIds, decodeJsonBody } from "@/lib/validate-result";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  goal: z.string().trim().min(1).max(200),
  results: z.array(ProductResearchResultSchema).min(1, "至少需要一个产品结果"),
});

export async function POST(request: Request) {
  const decoded = await decodeJsonBody(request, RequestSchema);
  if (!decoded.ok) {
    return NextResponse.json({ error: decoded.error }, { status: 400 });
  }

  const { goal, results } = decoded.data;

  try {
    const report = await buildReport(goal, results, collectSourceIds(results));
    return NextResponse.json(report);
  } catch (error) {
    console.error("[api/report]", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
