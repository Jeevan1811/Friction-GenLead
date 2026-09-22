"use client";

import clsx from "clsx";

type SkeletonVariant = "text" | "card" | "table-row" | "avatar";

interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
}

const variantDefaults: Record<SkeletonVariant, { width: string; height: string; borderRadius: string }> = {
  text: { width: "100%", height: "14px", borderRadius: "var(--radius-sm)" },
  card: { width: "100%", height: "120px", borderRadius: "var(--radius-md)" },
  "table-row": { width: "100%", height: "48px", borderRadius: "var(--radius-sm)" },
  avatar: { width: "40px", height: "40px", borderRadius: "50%" },
};

export function Skeleton({ variant = "text", width, height, className }: SkeletonProps) {
  const defaults = variantDefaults[variant];

  if (variant === "table-row") {
    return (
      <div
        className={clsx("skeleton-row", className)}
        style={{
          display: "flex",
          gap: "12px",
          alignItems: "center",
          width: width != null ? (typeof width === "number" ? `${width}px` : width) : defaults.width,
          height: height != null ? (typeof height === "number" ? `${height}px` : height) : defaults.height,
          padding: "0 16px",
        }}
      >
        <span className="skeleton-pulse" style={{ width: "32px", height: "14px", borderRadius: "var(--radius-sm)", flexShrink: 0 }} />
        <span className="skeleton-pulse" style={{ flex: 2, height: "14px", borderRadius: "var(--radius-sm)" }} />
        <span className="skeleton-pulse" style={{ flex: 1, height: "14px", borderRadius: "var(--radius-sm)" }} />
        <span className="skeleton-pulse" style={{ width: "60px", height: "14px", borderRadius: "var(--radius-sm)", flexShrink: 0 }} />
      </div>
    );
  }

  return (
    <span
      className={clsx("skeleton-pulse", className)}
      style={{
        display: "block",
        width: width != null ? (typeof width === "number" ? `${width}px` : width) : defaults.width,
        height: height != null ? (typeof height === "number" ? `${height}px` : height) : defaults.height,
        borderRadius: defaults.borderRadius,
      }}
    />
  );
}

/* ---- CSS injected once ---- */
if (typeof document !== "undefined") {
  const STYLE_ID = "skeleton-pulse-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes skeleton-shimmer {
        0%   { opacity: 0.45; }
        50%  { opacity: 0.2; }
        100% { opacity: 0.45; }
      }
      .skeleton-pulse {
        background: var(--color-accent-light);
        animation: skeleton-shimmer 1.6s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
  }
}
