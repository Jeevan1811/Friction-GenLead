"use client";

import { useState, useCallback, useRef, type ReactNode, type KeyboardEvent } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";
import { Inbox } from "lucide-react";

/* ---------- Types ---------- */
export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
}

type SortDir = "asc" | "desc" | null;

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyState?: { title: string; description?: string };
  loading?: boolean;
  className?: string;
}

/* ---------- Component ---------- */
export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  emptyState,
  loading = false,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  /* Sort handler */
  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        if (sortDir === "asc") setSortDir("desc");
        else if (sortDir === "desc") { setSortKey(null); setSortDir(null); }
        else setSortDir("asc");
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey, sortDir]
  );

  /* Sorted data */
  const sorted = (() => {
    if (!sortKey || !sortDir) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const sa = String(av);
      const sb = String(bv);
      return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  })();

  /* Keyboard nav for rows */
  const handleRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, row: T, idx: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(row);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = tbodyRef.current?.children[idx + 1] as HTMLElement | undefined;
      next?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = tbodyRef.current?.children[idx - 1] as HTMLElement | undefined;
      prev?.focus();
    }
  };

  /* Loading skeleton */
  if (loading) {
    return (
      <div className={clsx("surface-card", className)} style={{ overflow: "hidden" }}>
        <div style={{ padding: "0" }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="table-row" />
          ))}
        </div>
      </div>
    );
  }

  /* Empty */
  if (data.length === 0) {
    return (
      <div className={clsx("surface-card", className)}>
        <EmptyState
          icon={Inbox}
          title={emptyState?.title ?? "No data"}
          description={emptyState?.description}
        />
      </div>
    );
  }

  return (
    <div className={clsx("surface-card", className)} style={{ overflow: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "13px",
        }}
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                style={{
                  textAlign: "left",
                  padding: "10px 16px",
                  fontSize: "11px",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                  borderBottom: "1px solid var(--color-border)",
                  cursor: col.sortable ? "pointer" : "default",
                  userSelect: "none",
                  whiteSpace: "nowrap",
                  background: "var(--color-surface)",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  {col.label}
                  {col.sortable && sortKey === col.key && sortDir === "asc" && (
                    <ChevronUp size={12} />
                  )}
                  {col.sortable && sortKey === col.key && sortDir === "desc" && (
                    <ChevronDown size={12} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody ref={tbodyRef}>
          {sorted.map((row, idx) => (
            <tr
              key={idx}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => handleRowKeyDown(e, row, idx) : undefined}
              className="data-table-row"
              style={{
                cursor: onRowClick ? "pointer" : "default",
                transition: "background var(--transition-fast)",
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={{
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--color-border-subtle)",
                    color: "var(--color-text)",
                  }}
                >
                  {col.render ? col.render(row) : (row[col.key] as ReactNode) ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- Inject hover style ---- */
if (typeof document !== "undefined") {
  const STYLE_ID = "data-table-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .data-table-row:hover {
        background: var(--color-accent-light) !important;
      }
      .data-table-row:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: -2px;
      }
    `;
    document.head.appendChild(style);
  }
}
