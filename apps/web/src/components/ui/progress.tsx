"use client";

import clsx from "clsx";

interface ProgressProps {
  value: number; // 0–100
  label?: string;
  size?: "sm" | "md" | "lg";
  color?: "accent" | "success" | "warning" | "error";
  className?: string;
}

const sizeMap = { sm: 4, md: 8, lg: 12 } as const;

const colorMap: Record<NonNullable<ProgressProps["color"]>, string> = {
  accent:  "var(--color-accent)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error:   "var(--color-error)",
};

export function Progress({
  value,
  label,
  size = "md",
  color = "accent",
  className,
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const h = sizeMap[size];

  return (
    <div className={clsx(className)} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {/* Label row */}
      {label && (
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
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
            }}
          >
            {Math.round(clamped)}%
          </span>
        </div>
      )}

      {/* Track */}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
        style={{
          width: "100%",
          height: `${h}px`,
          borderRadius: `${h / 2}px`,
          background: "var(--color-border-subtle)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            borderRadius: `${h / 2}px`,
            background: colorMap[color],
            transition: "width var(--transition-normal)",
          }}
        />
      </div>
    </div>
  );
}
