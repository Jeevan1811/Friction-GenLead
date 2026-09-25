import { AlertTriangle } from "lucide-react";

/** Explains the scope and evidence limits of public-source prospect search. */
export function SampleDataNotice() {
  return (
    <div
      role="note"
      style={{
        display: "flex",
        gap: "10px",
        alignItems: "flex-start",
        padding: "10px 12px",
        marginBottom: "16px",
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
        <strong>These are unverified candidates; coverage varies.</strong> Review each company before contacting it.
        <details style={{ marginTop: "4px" }}>
          <summary style={{ cursor: "pointer", fontSize: "12px" }}>Search limits and sources</summary>
          <p style={{ margin: "4px 0 0", fontSize: "12px" }}>
            Searches use the latest Overture Maps Places release and may add ABR name matches for Queensland postcodes. Industry categories are clues, not proof. Saved records retain available source and license details; listed sites and contacts remain unverified until reviewed.
          </p>
        </details>
      </div>
    </div>
  );
}
