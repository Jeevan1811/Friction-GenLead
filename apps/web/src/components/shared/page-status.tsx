"use client";

import { AlertCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

/**
 * Consistent loading / error placeholders for pages that fetch their data
 * (list pages that used to synchronously read a `@/lib/fixtures` array now
 * fetch it, which needs both). Styled to match the app's existing patterns
 * -- `<Spinner>` from `@/components/ui/spinner`, and an inline alert box in
 * the same style as the login page's `ErrorMessage`.
 */

export function PageLoading({ label = "Loading..." }: { label?: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        padding: "64px 24px",
      }}
    >
      <Spinner size="lg" />
      <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>{label}</p>
    </div>
  );
}

export function PageError({ message }: { message: string }) {
  return (
    <div
      className="surface-card"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "16px 20px",
        fontSize: "13px",
        color: "var(--color-error)",
        background: "var(--color-accent-light)",
        border: "1px solid var(--color-error)",
      }}
      role="alert"
    >
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
      <span style={{ color: "var(--color-text)", lineHeight: 1.5 }}>{message}</span>
    </div>
  );
}
