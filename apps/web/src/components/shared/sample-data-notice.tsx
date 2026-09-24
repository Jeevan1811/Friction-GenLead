import { AlertTriangle } from "lucide-react";

/**
 * Automated research (Search page / Searches history) is not connected to the
 * real Australian Business Register or a real contact finder yet -- it returns
 * demonstration companies. Say so plainly wherever its results appear, so
 * nobody mistakes them for real prospects.
 */
export function SampleDataNotice() {
  return (
    <div
      role="note"
      style={{
        display: "flex",
        gap: "10px",
        alignItems: "flex-start",
        padding: "12px 14px",
        marginBottom: "20px",
        borderRadius: "var(--radius-md)",
        background: "#FFFBEB",
        border: "1px solid #FCD34D",
        color: "#92400E",
        fontSize: "13px",
        lineHeight: 1.5,
      }}
    >
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
      <div>
        <strong>Automated research uses sample data for now.</strong> It isn&apos;t connected to the
        Australian Business Register or a live contact finder yet, so the companies and contacts it
        produces are examples, not real prospects. Your real customer data is on the Companies,
        Locations and Contacts pages.
      </div>
    </div>
  );
}
