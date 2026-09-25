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
        <strong>Public-source search is best effort, not a complete company directory.</strong> Enter a city,
        region, country or postcode to look for nearby candidates in the latest Overture Maps Places release;
        QLD postcode searches may also check ABR name matches. Coverage is uneven and a search may take some time.
        An industry choice filters mapped categories but does not prove sector fit. Listed websites may be crawled for explicitly named people
        and public contact channels; every result stays unverified until you review it. New
        candidates are saved to the Google Sheet with release, source links, contributing-source records and
        license metadata where supplied, plus evidence labels. Overture Places has source-dependent licenses.
      </div>
    </div>
  );
}
