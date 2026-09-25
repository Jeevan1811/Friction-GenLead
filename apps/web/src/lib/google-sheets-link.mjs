/** Build a fixed-origin spreadsheet link from the ID supplied by sync status. */
export function buildGoogleSheetUrl(spreadsheetId) {
  const id = typeof spreadsheetId === "string" ? spreadsheetId.trim() : "";
  if (!id || id.length > 200 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
