import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel Hobby allows up to 300s on Fluid Compute. Set explicitly so a local
  // `next start` run matches production behaviour — see PLAN.md §3.2.
  serverExternalPackages: ["echarts"],
};

export default nextConfig;
