import { AlertTriangle } from "lucide-react";

/**
 * Automated research is intentionally unavailable until live company and
 * contact sources are connected. No sample prospects are presented as real.
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
        <strong>New prospect searches are not connected yet.</strong> The live company registry and
        contact-finder integrations are not configured, so GenLead will not create or display
        sample prospects. The workbook data already imported is available on Companies, Locations
        and Contacts.
      </div>
    </div>
  );
}
