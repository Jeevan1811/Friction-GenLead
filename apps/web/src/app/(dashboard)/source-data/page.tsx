"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileSearch, RefreshCw, Search } from "lucide-react";
import { getSourceRecords } from "@/lib/api";
import type { SourceRecord, SourceRecordPage } from "@/lib/types";
import { PageError, PageLoading } from "@/components/shared/page-status";
import { Pager, PAGE_SIZE } from "@/components/shared/pager";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";

type RawCell = { column?: string; header?: string; value?: string };
type RawData = { headers?: string[]; cells?: RawCell[] };

function rawCells(record: SourceRecord): RawCell[] {
  try {
    const parsed = JSON.parse(record.rawDataJson) as RawData;
    return Array.isArray(parsed.cells) ? parsed.cells : [];
  } catch {
    return [];
  }
}

export default function SourceDataPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SourceRecordPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (initial = false) => {
    const currentRequest = ++requestId.current;
    if (initial) setLoading(true);
    setError(null);
    try {
      const next = await getSourceRecords(query.trim(), page + 1, PAGE_SIZE);
      if (currentRequest === requestId.current) setResult(next);
    } catch (err) {
      if (currentRequest === requestId.current) {
        setError(err instanceof Error ? err.message : "Could not load source records.");
      }
    } finally {
      if (initial && currentRequest === requestId.current) setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 220);
    return () => window.clearTimeout(timer);
  }, [load]);
  useSheetAutoRefresh(() => load());

  return (
    <div style={{ padding: "24px", maxWidth: "1180px" }}>
      <div style={{ marginBottom: "20px" }}>
        <h1 data-tour="source-data-overview" style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Original source data
        </h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", marginTop: "5px" }}>
          Search the original rows from MSV’s Excel workbooks, including fields that don’t fit neatly into a company, site or contact record.
        </p>
      </div>

      <div className="surface-card" style={{ padding: "16px", marginBottom: "16px" }}>
        <label htmlFor="source-search" style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>
          Search every imported source field
        </label>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: 13, color: "var(--color-text-muted)" }} />
            <input
              id="source-search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
              placeholder="Company, phone, contact, postcode, source note…"
              style={{ width: "100%", minHeight: 42, padding: "0 12px 0 38px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-bg)", color: "var(--color-text)", font: "inherit", fontSize: "13px" }}
            />
          </div>
          <button type="button" className="btn-secondary" onClick={() => void load()} aria-label="Refresh source data" title="Refresh source data" style={{ minHeight: 42, padding: "0 12px" }}>
            <RefreshCw size={15} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--color-text-muted)", fontSize: "11px", marginTop: "9px" }}>
          <FileSearch size={13} />
          {result ? `${result.total.toLocaleString()} matching source rows` : "Search covers the original row values"}
          <span>·</span>
          <span>refreshes automatically while open</span>
        </div>
      </div>

      {error && <div style={{ marginBottom: 14 }}><PageError message={error} /></div>}
      {loading && !result ? <PageLoading label="Loading source records…" /> : (
        <div className="surface-card" style={{ overflow: "hidden" }}>
          {!result?.items.length ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--color-text-secondary)", fontSize: "13px" }}>
              {query ? "No source rows match that search." : "No imported source rows are available yet."}
            </div>
          ) : (
            <div style={{ display: "grid" }}>
              {result.items.map((record) => (
                <SourceRecordCard key={record.sourceRecordId} record={record} />
              ))}
            </div>
          )}
          {result && <Pager page={page} pageSize={PAGE_SIZE} total={result.total} onChange={setPage} />}
        </div>
      )}
    </div>
  );
}

function SourceRecordCard({ record }: { record: SourceRecord }) {
  const cells = rawCells(record);
  const details = cells.filter((cell) => cell.value).map((cell) => ({
    label: cell.header?.trim() || `Column ${cell.column || "?"}`,
    value: cell.value || "",
    column: cell.column || "",
  }));
  const linked = record.recordType === "SOURCE_ROW";

  return (
    <article style={{ padding: "15px 18px", borderBottom: "1px solid var(--color-border-subtle)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: "13px" }}>{record.companyName || "Unmatched source row"}</strong>
            <span style={{ borderRadius: 99, padding: "3px 8px", background: linked ? "var(--color-accent-light)" : "var(--color-border-subtle)", color: linked ? "var(--color-accent)" : "var(--color-text-secondary)", fontSize: "10px", fontWeight: 600 }}>
              {linked ? "Linked to company" : record.recordType.replaceAll("_", " ").toLowerCase()}
            </span>
          </div>
          <div style={{ color: "var(--color-text-secondary)", fontSize: "11px", marginTop: 5 }}>
            {record.sourceWorkbook} · {record.sourceSheet} · row {record.sourceRow} · {record.sourceField}
          </div>
          <div style={{ display: "flex", gap: "6px 14px", flexWrap: "wrap", color: "var(--color-text-muted)", fontSize: "11px", marginTop: 7 }}>
            {record.contactName && <span>Contact: {record.contactName}</span>}
            {record.landlineRaw && <span>Landline: {record.landlineRaw}</span>}
            {record.postcodeRaw && <span>Postcode: {record.postcodeRaw}</span>}
            {record.verificationSourceRaw && <span>Source: {record.verificationSourceRaw}</span>}
            {record.legacySourceText && <span>Original text: {record.legacySourceText}</span>}
          </div>
        </div>
        <details style={{ flexShrink: 0 }}>
          <summary style={{ cursor: "pointer", color: "var(--color-accent)", fontSize: "11px", fontWeight: 500 }}>View all original fields ({details.length})</summary>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 0.7fr) minmax(180px, 1.3fr)", gap: "6px 12px", minWidth: "min(560px, 85vw)", maxHeight: 320, overflow: "auto", padding: 12, marginTop: 8, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-bg)" }}>
            {details.map((cell, index) => (
              <div key={`${cell.column}-${index}`} style={{ display: "contents" }}>
                <span style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>{cell.label}</span>
                <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "11px" }}>{cell.value}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </article>
  );
}
