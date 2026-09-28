/**
 * @param {{ companyId?: string | null, rawDataJson: string }} record
 * @returns {{ companyHref: string | null, hasOriginalSnapshot: boolean, originalFields: Array<{ key: string, label: string, value: string }>, rawSnapshotText: string }}
 */
export function getSourceRecordPresentation(record) {
  let payload;
  try {
    payload = JSON.parse(record.rawDataJson);
  } catch {
    payload = null;
  }

  const hasOriginalSnapshot = Boolean(payload && Array.isArray(payload.cells));
  const originalFields = hasOriginalSnapshot
    ? payload.cells.map((cell, index) => {
        const column = cell && typeof cell === "object" ? cell.column : null;
        const header = cell && typeof cell === "object" ? cell.header : null;
        const rawValue = cell && typeof cell === "object" ? cell.value : cell;
        return {
          key: `${column || "column"}-${index}`,
          label:
            typeof header === "string" && header.trim()
              ? header.trim()
              : `Column ${column || index + 1}`,
          value: rawValue == null ? "" : String(rawValue),
        };
      })
    : [];
  const companyId = typeof record.companyId === "string" ? record.companyId : "";

  return {
    companyHref: companyId
      ? `/companies?companyId=${encodeURIComponent(companyId)}`
      : null,
    hasOriginalSnapshot,
    originalFields,
    rawSnapshotText: record.rawDataJson,
  };
}
