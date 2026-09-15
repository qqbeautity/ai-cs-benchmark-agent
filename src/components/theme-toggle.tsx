"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = window.localStorage.getItem("theme") as Theme | null;
    if (stored) setTheme(stored);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    // 'system' clears the stamp so the media query takes over again.
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
      window.localStorage.removeItem("theme");
    } else {
      document.documentElement.setAttribute("data-theme", next);
      window.localStorage.setItem("theme", next);
    }
  }

  const order: Theme[] = ["system", "light", "dark"];
  const labels: Record<Theme, string> = { system: "跟随系统", light: "浅色", dark: "深色" };

  return (
    <button
      type="button"
      onClick={() => apply(order[(order.indexOf(theme) + 1) % order.length])}
      className="no-print rounded-md border px-2.5 py-1 text-xs transition-colors hover:opacity-80"
      style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
      aria-label={`当前主题：${labels[theme]}，点击切换`}
    >
      {labels[theme]}
    </button>
  );
}
