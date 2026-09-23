"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE = 50;

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

/**
 * Prev/next pager for the client-side-paginated list pages. The Sheet holds
 * thousands of rows per tab; rendering them all at once froze the browser.
 */
export function Pager({ page, pageSize, total, onChange }: PagerProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  const btn = (disabled: boolean) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "6px 12px",
    fontSize: "12px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: disabled ? "var(--color-text-muted)" : "var(--color-text)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderTop: "1px solid var(--color-border)",
        fontSize: "12px",
        color: "var(--color-text-secondary)",
      }}
    >
      <span>
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
          style={btn(page === 0)}
        >
          <ChevronLeft size={14} /> Previous
        </button>
        <span>
          Page {page + 1} of {pageCount.toLocaleString()}
        </span>
        <button
          type="button"
          disabled={page >= pageCount - 1}
          onClick={() => onChange(page + 1)}
          style={btn(page >= pageCount - 1)}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
