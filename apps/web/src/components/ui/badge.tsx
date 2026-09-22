"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "muted";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string }> = {
  default: { bg: "var(--color-accent-light)", text: "var(--color-accent)" },
  success: { bg: "#F0FDF4", text: "#16A34A" },
  warning: { bg: "#FFFBEB", text: "#D97706" },
  error:   { bg: "#FEF2F2", text: "#DC2626" },
  info:    { bg: "#EFF6FF", text: "#2563EB" },
  muted:   { bg: "var(--color-border-subtle)", text: "var(--color-text-muted)" },
};

export function Badge({ children, variant = "default", size = "md", className }: BadgeProps) {
  const colors = variantStyles[variant];

  return (
    <span
      className={clsx(className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: size === "sm" ? "1px 6px" : "2px 10px",
        fontSize: size === "sm" ? "10px" : "11px",
        fontWeight: 500,
        letterSpacing: "0.02em",
        lineHeight: size === "sm" ? "16px" : "20px",
        borderRadius: "var(--radius-pill)",
        background: colors.bg,
        color: colors.text,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
