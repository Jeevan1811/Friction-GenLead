"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search } from "lucide-react";
import { getSourceRecords } from "@/lib/api";
import type { SourceRecord, SourceRecordPage } from "@/lib/types";
import { getSourceRecordPresentation } from "@/lib/source-data-record.mjs";
import { PageError, PageLoading } from "@/components/shared/page-status";
import { Pager, PAGE_SIZE } from "@/components/shared/pager";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";

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
    <div className="source-data-page">
      <header className="source-data-heading">
        <h1 data-tour="source-data-overview">Original data</h1>
        <p>Imported workbook rows</p>
      </header>

      <section className="source-data-controls" aria-label="Search original data">
        <label className="source-data-search">
          <span className="sr-only">Search original rows</span>
          <Search size={16} aria-hidden="true" />
          <input
            name="sourceSearch"
            autoComplete="off"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            placeholder="Company, contact, phone, postcode, source note…"
            type="search"
          />
        </label>
        <button
          type="button"
          className="btn-secondary source-data-refresh"
          onClick={() => void load()}
          aria-label="Refresh original rows"
          title="Refresh original rows"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
        <p className="source-data-count" role="status" aria-live="polite">
          {result
            ? `${result.total.toLocaleString()} matching ${result.total === 1 ? "row" : "rows"}`
            : "Search imported rows"}
        </p>
      </section>

      {error && <div className="source-data-error"><PageError message={error} /></div>}
      {loading && !result ? <PageLoading label="Loading original rows…" /> : (
        <section className="source-data-list surface-card" aria-label="Original source rows" aria-busy={loading}>
          {!result?.items.length ? (
            <div className="source-data-empty">
              {query ? "No source rows match that search." : "No imported source rows are available yet."}
            </div>
          ) : (
            result.items.map((record) => (
              <SourceRecordRow key={record.sourceRecordId} record={record} />
            ))
          )}
          {result && <Pager page={page} pageSize={PAGE_SIZE} total={result.total} onChange={setPage} />}
        </section>
      )}
    </div>
  );
}

function SourceRecordRow({ record }: { record: SourceRecord }) {
  const presentation = getSourceRecordPresentation(record);

  return (
    <article className="source-data-row">
      <h2 className="source-data-company">
        {presentation.companyHref ? (
          <Link href={presentation.companyHref}>
            {record.companyName || "Linked company"}
          </Link>
        ) : (
          record.companyName || "Unmatched source row"
        )}
        {!presentation.companyHref && <span className="source-data-unlinked">Unlinked</span>}
      </h2>

      <p className="source-data-provenance">
        <span>{record.sourceWorkbook}</span>
        <span aria-hidden="true">·</span>
        <span>{record.sourceSheet}</span>
        <span aria-hidden="true">·</span>
        <span>Row {record.sourceRow}</span>
        {record.sourceField && <><span aria-hidden="true">·</span><span>{record.sourceField}</span></>}
      </p>

      {(record.contactName || record.landlineRaw || record.postcodeRaw) && (
        <p className="source-data-summary">
          {record.contactName && <span>{record.contactName}</span>}
          {record.landlineRaw && <span>{record.landlineRaw}</span>}
          {record.postcodeRaw && <span>Postcode {record.postcodeRaw}</span>}
        </p>
      )}

      <details className="source-data-details">
        <summary>Original fields ({presentation.originalFields.length})</summary>
        {presentation.hasOriginalSnapshot ? (
          presentation.originalFields.length ? (
            <dl className="source-data-fields">
              {presentation.originalFields.map((field) => (
                <div className="source-data-field" key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>{field.value || <span className="source-data-blank">(blank)</span>}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="source-data-snapshot-note">No original fields are included in this row.</p>
          )
        ) : (
          <>
            <p className="source-data-snapshot-note">
              The original fields could not be parsed. The stored snapshot is shown unchanged below.
            </p>
            <pre className="source-data-snapshot-fallback">{presentation.rawSnapshotText}</pre>
          </>
        )}
      </details>
    </article>
  );
}
