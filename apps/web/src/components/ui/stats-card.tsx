"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

interface StatsCardProps {
  label: string;
  value: number;
  change?: number;
  trend?: "up" | "down";
  icon?: LucideIcon;
  className?: string;
}

export function StatsCard({ label, value, change, trend, icon: Icon, className }: StatsCardProps) {
  const [displayed, setDisplayed] = useState(0);
  const rafRef = useRef<number>();
  const startRef = useRef<number>();

  /* Animate the number counting up on mount */
  useEffect(() => {
    const duration = 600; // ms
    const target = value;

    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(eased * target));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    startRef.current = undefined;
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  const trendColor = trend === "up" ? "var(--color-success)" : trend === "down" ? "var(--color-error)" : "var(--color-text-muted)";

  return (
    <div
      className={clsx("surface-card", className)}
      style={{
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {/* Top row: label + icon */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 500,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          {label}
        </span>
        {Icon && <Icon size={16} color="var(--color-text-muted)" strokeWidth={1.5} />}
      </div>

      {/* Value */}
      <span
        style={{
          fontSize: "28px",
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          color: "var(--color-text)",
        }}
      >
        {displayed.toLocaleString()}
      </span>

      {/* Trend */}
      {change != null && trend && (
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {trend === "up" ? (
            <TrendingUp size={14} color={trendColor} />
          ) : (
            <TrendingDown size={14} color={trendColor} />
          )}
          <span
            style={{
              fontSize: "12px",
              fontWeight: 500,
              color: trendColor,
            }}
          >
            {change > 0 ? "+" : ""}{change}%
          </span>
        </div>
      )}
    </div>
  );
}
