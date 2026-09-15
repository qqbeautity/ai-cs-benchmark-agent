"use client";

import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { TOTAL_DIMENSIONS, type DoneResult } from "@/lib/types";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * One series (dimensions confirmed per product), so: sequential single hue,
 * direct value labels instead of a legend, no colour-cycling.
 *
 * A chart, not a table, because this IS a magnitude comparison — unlike the
 * pricing section, where the underlying values are rarely comparable.
 */
export function CoverageChart({ products }: { products: DoneResult[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const paint = () => {
      const surface = readToken("--surface-1", "#fcfcfb");
      const ink = readToken("--text-primary", "#0b0b0b");
      const muted = readToken("--text-muted", "#898781");
      const gridline = readToken("--gridline", "#e1e0d9");
      const axis = readToken("--axis", "#c3c2b7");
      const bar = readToken("--seq-450", "#2a78d6");

      // Ascending so the strongest product sits at the top of the bar chart.
      const sorted = [...products].sort((a, b) => a.confirmedDimensions - b.confirmedDimensions);

      chart.setOption(
        {
          backgroundColor: "transparent",
          animationDuration: 300,
          // Right padding has to clear both the direct value labels and the
          // final x-axis tick, or the "10" gridline label runs off the edge.
          grid: { left: 8, right: 72, top: 8, bottom: 8, containLabel: true },
          tooltip: {
            trigger: "item",
            backgroundColor: surface,
            borderColor: axis,
            textStyle: { color: ink, fontSize: 12 },
            formatter: (params: { name: string; value: number }) =>
              `${params.name}<br/>已确认 <b>${params.value}</b> / ${TOTAL_DIMENSIONS} 个维度`,
          },
          xAxis: {
            type: "value",
            max: TOTAL_DIMENSIONS,
            splitLine: { lineStyle: { color: gridline, width: 1 } },
            axisLabel: { color: muted, fontSize: 11 },
            axisLine: { show: false },
            axisTick: { show: false },
          },
          yAxis: {
            type: "category",
            data: sorted.map((p) => p.name),
            axisLabel: { color: ink, fontSize: 12 },
            axisLine: { lineStyle: { color: axis } },
            axisTick: { show: false },
          },
          series: [
            {
              type: "bar",
              data: sorted.map((p) => p.confirmedDimensions),
              barMaxWidth: 22,
              // Rounded data-end only; the baseline end stays square so bars
              // read as anchored rather than floating.
              itemStyle: { color: bar, borderRadius: [0, 4, 4, 0] },
              // Direct labels: a single series needs no legend box.
              label: {
                show: true,
                position: "right",
                formatter: `{c} / ${TOTAL_DIMENSIONS}`,
                color: ink,
                fontSize: 12,
                fontWeight: 500,
              },
              emphasis: { itemStyle: { opacity: 0.85 } },
            },
          ],
        },
        true,
      );
    };

    paint();

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);

    // Repaint on theme change — dark mode is its own set of steps, not a flip.
    const themeObserver = new MutationObserver(paint);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", paint);

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      media.removeEventListener("change", paint);
      chart.dispose();
      chartRef.current = null;
    };
  }, [products]);

  return (
    <div
      ref={ref}
      role="img"
      style={{ width: "100%", height: `${Math.max(160, products.length * 56 + 60)}px` }}
      aria-label={`各产品已确认维度数量对比：${products
        .map((p) => `${p.name} ${p.confirmedDimensions} 项`)
        .join("，")}`}
    />
  );
}
