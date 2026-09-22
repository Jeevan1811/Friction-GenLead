"use client";

import clsx from "clsx";

type StatusVariant =
  | "NEW"
  | "VERIFYING"
  | "REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "STALE"
  | "INACTIVE"
  | "ERROR"
  | "UNVERIFIED"
  | "VERIFIED"
  | "CLOSED"
  | "DISPUTED"
  | "LEFT_COMPANY"
  | "PRIORITY"
  | "SECONDARY"
  | "OTHER"
  | "TARGET"
  | "ADJACENT"
  | "UNLIKELY"
  | "EXCLUDED"
  | "PLANT"
  | "MINE"
  | "OFFICE"
  | "PROJECT"
  | "DEPOT";

const variantStyles: Record<
  string,
  { bg: string; text: string; dot?: string }
> = {
  NEW: { bg: "#EFF6FF", text: "#2563EB", dot: "#2563EB" },
  VERIFYING: { bg: "#FFFBEB", text: "#D97706", dot: "#D97706" },
  REVIEW: { bg: "#FFF7ED", text: "#EA580C", dot: "#EA580C" },
  APPROVED: { bg: "#F0FDF4", text: "#16A34A", dot: "#16A34A" },
  REJECTED: { bg: "#FEF2F2", text: "#DC2626", dot: "#DC2626" },
  STALE: { bg: "#F9FAFB", text: "#6B7280", dot: "#6B7280" },
  INACTIVE: { bg: "#F1F5F9", text: "#64748B", dot: "#64748B" },
  ERROR: { bg: "#FEF2F2", text: "#DC2626", dot: "#DC2626" },
  UNVERIFIED: { bg: "#F9FAFB", text: "#6B7280", dot: "#6B7280" },
  VERIFIED: { bg: "#F0FDF4", text: "#16A34A", dot: "#16A34A" },
  CLOSED: { bg: "#F1F5F9", text: "#64748B", dot: "#64748B" },
  DISPUTED: { bg: "#FFF7ED", text: "#EA580C", dot: "#EA580C" },
  LEFT_COMPANY: { bg: "#F1F5F9", text: "#64748B", dot: "#64748B" },
  PRIORITY: { bg: "#FEF2F1", text: "#C8372D", dot: "#C8372D" },
  SECONDARY: { bg: "#EFF6FF", text: "#2563EB", dot: "#2563EB" },
  OTHER: { bg: "#F9FAFB", text: "#6B7280", dot: "#6B7280" },
  TARGET: { bg: "#F0FDF4", text: "#16A34A", dot: "#16A34A" },
  ADJACENT: { bg: "#FFFBEB", text: "#D97706", dot: "#D97706" },
  UNLIKELY: { bg: "#F9FAFB", text: "#6B7280", dot: "#6B7280" },
  EXCLUDED: { bg: "#FEF2F2", text: "#DC2626", dot: "#DC2626" },
  PLANT: { bg: "#EFF6FF", text: "#2563EB" },
  MINE: { bg: "#FFFBEB", text: "#D97706" },
  OFFICE: { bg: "#F1F5F9", text: "#64748B" },
  PROJECT: { bg: "#F5F3FF", text: "#7C3AED" },
  DEPOT: { bg: "#FFF7ED", text: "#EA580C" },
};

interface StatusBadgeProps {
  status: StatusVariant | string;
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  showDot = false,
  className,
}: StatusBadgeProps) {
  const style = variantStyles[status] ?? {
    bg: "#F9FAFB",
    text: "#6B7280",
    dot: "#6B7280",
  };

  const label = status.replace(/_/g, " ");

  return (
    <span
      className={clsx("status-badge", className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "2px 10px",
        fontSize: "11px",
        fontWeight: 500,
        letterSpacing: "0.02em",
        lineHeight: "20px",
        borderRadius: "var(--radius-pill)",
        background: style.bg,
        color: style.text,
        whiteSpace: "nowrap",
      }}
    >
      {showDot && style.dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: style.dot,
            flexShrink: 0,
          }}
        />
      )}
      {label}
    </span>
  );
}
