import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "AI 客服竞品横评 Agent",
  description:
    "输入 3–5 个 AI 客服产品，自动联网调研并生成带证据来源、对比矩阵与 AI 洞察的横评报告。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        <header
          className="no-print sticky top-0 z-10 border-b backdrop-blur"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--plane) 88%, transparent)" }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">AI 客服竞品横评 Agent</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                作品集 MVP
              </span>
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer
          className="mx-auto max-w-6xl px-6 pb-10 pt-4 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <p>
            所有结论均标注证据等级：已核实事实 / AI 推断 / 待确认。公开资料无法确认的信息一律标记为「未知」，
            不做推测填充。
          </p>
        </footer>
      </body>
    </html>
  );
}
