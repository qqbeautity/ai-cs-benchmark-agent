import { NextResponse } from "next/server";
import { z } from "zod";
import { researchProduct } from "@/lib/research";
import { decodeJsonBody } from "@/lib/validate-result";

/**
 * A single product's chain (3 searches + one model call) runs 30-90s.
 * Vercel Hobby caps Fluid Compute at 300s; on Netlify's flat 60s sync limit
 * this route would be cut off mid-flight (PLAN.md §3.2).
 */
export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  name: z.string().trim().min(1, "产品名称不能为空").max(80, "产品名称过长"),
  officialUrl: z.string().trim().max(300).optional(),
  allowThirdParty: z.boolean().default(true),
});

export async function POST(request: Request) {
  const decoded = await decodeJsonBody(request, RequestSchema);
  if (!decoded.ok) {
    return NextResponse.json({ error: decoded.error }, { status: 400 });
  }

  const started = Date.now();
  const result = await researchProduct(decoded.data, {
    log: (message) => console.log(message),
  });
  const elapsed = Date.now() - started;

  console.log(`[api] ${decoded.data.name} -> ${result.status} (${elapsed}ms)`);

  // Research failures are domain outcomes, not transport errors: the body is a
  // discriminated union the front end needs in order to render an actionable
  // card with a retry button, so this stays a 200 even when `status` is
  // `failed`. Non-200 is reserved for malformed requests.
  return NextResponse.json(result);
}
