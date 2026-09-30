import { AlertTriangle } from "lucide-react";
import { InfoPopover } from "@/components/shared/info-popover";

/** Explains the scope and evidence limits of public-source prospect search. */
export function SampleDataNotice() {
  return (
    <div
      role="note"
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "center",
        padding: "6px 12px",
        marginBottom: "16px",
        borderRadius: "var(--radius-md)",
        background: "#FFF7E8",
        border: "1px solid #F2D6A9",
        color: "#754C16",
        fontSize: "12px",
        lineHeight: 1.3,
      }}
    >
      <AlertTriangle size={15} style={{ flexShrink: 0 }} aria-hidden="true" />
      <strong>Unverified leads · review before contacting</strong>
      <InfoPopover label="Search sources" text="Search combines mapped places and public web results. Queensland postcodes may add ABR name matches. Coverage varies; categories and contact details need your review." />
    </div>
  );
}
