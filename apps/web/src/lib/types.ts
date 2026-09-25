/* ============================================================
   Shared domain types for Friction GenLead prospecting.

   These interfaces are the frontend's view of the data that lives
   in the Google Sheet (via the FastAPI `/internal/data/*` routes)
   and the Jev research pipeline (via `/internal/ops/jobs`). They
   used to live inline in `@/lib/fixtures` alongside mock data
   arrays; the mock arrays are gone (every page now fetches real
   data), but the interfaces are still the correct shared contract,
   so they were moved here rather than duplicated.

   Field names are camelCase on the frontend. The backend's Google
   Sheets adapter reads/writes snake_case columns (see
   `services/research/app/services/sheets_config.py`); the
   `/internal/data/*` router converts every row to camelCase before
   it reaches the frontend, so these interfaces line up with the
   JSON as-received with zero reshaping needed here.
   ============================================================ */

export interface Company {
  companyId: string;
  abn: string;
  companyName: string;
  normalizedName: string;
  tradingName?: string;
  website?: string;
  industry?: string;
  abnStatus?: string;
  status: string;
  industryFit: string;
  priority?: number;
  source: string;
  lastVerified?: string;
  lastModified: string;
  notes?: string;
  sourceVerification?: string;
  businessLandlines?: string;
  businessPhone?: string;
  businessEmail?: string;
  legacySourceText?: string;
  sourceProvenance?: string;
  sourceQualityFlags?: string;
  country?: string;
  countryCode?: string;
}

export interface Location {
  locationId: string;
  companyId: string;
  siteName: string;
  locationType: string;
  address?: string;
  suburb?: string;
  state: string;
  postcode: string;
  lat?: number;
  lng?: number;
  verificationStatus: string;
  lastVerified?: string;
  lastModified: string;
  rawPostcode?: string;
  sourceProvenance?: string;
  sourceQualityFlags?: string;
  country?: string;
  countryCode?: string;
  coordinateSource?: "SHEET" | "POSTCODE_CENTROID" | "UNAVAILABLE" | string;
}

export interface Contact {
  contactId: string;
  companyId: string;
  locationId?: string;
  name: string;
  position?: string;
  roleBucket?: string;
  rolePriority: string;
  businessEmail?: string;
  mobile?: string;
  landline?: string;
  professionalUrl?: string;
  contactStatus: string;
  lastVerified?: string;
  lastModified: string;
  professionalUrlRaw?: string;
  sourceProvenance?: string;
  sourceQualityFlags?: string;
}

export interface SourceRecord {
  sourceRecordId: string;
  recordType: string;
  companyId?: string | null;
  companyName?: string | null;
  sourceWorkbook: string;
  sourceSheet: string;
  sourceRow: string;
  sourceField: string;
  postcodeRaw?: string | null;
  contactName?: string | null;
  landlineRaw?: string | null;
  verificationSourceRaw?: string | null;
  legacySourceText?: string | null;
  rawDataJson: string;
  sourceSha256: string;
}

export interface SourceRecordPage {
  items: SourceRecord[];
  total: number;
  page: number;
  page_size: number;
}

export interface RejectedEntity {
  entityId: string;
  entityType: "company" | "location" | "contact";
  entityName: string;
  reason: string;
  rejectedBy: string;
  rejectedAt: string;
  // No fixture counterpart -- carried through from the Rejected tab's
  // `original_data` column (a JSON snapshot of the entity at the time
  // it was rejected). Optional and currently unused by the UI.
  originalData?: string;
}

/**
 * Sync health, as returned by `GET /internal/data/sync-status`
 * (camelCase view of `GoogleSheetsAdapter.get_sync_status()`).
 *
 * Note this is NOT the same shape as the old fixture `SyncStatus` --
 * the adapter doesn't track a per-entity "errors" list, and its raw
 * `mode`/`connected` fields don't map 1:1 onto the four-state
 * SYNCED/PENDING/ERROR/NEVER the `<SyncIndicator>` component expects.
 * `state` below is a value the backend derives from `mode`/`connected`
 * specifically for that component: "live" + connected -> SYNCED,
 * "mock" (no real spreadsheet configured) -> NEVER, not connected ->
 * ERROR.
 */
export interface SyncStatus {
  connected: boolean;
  mode: "mock" | "live";
  spreadsheetId: string | null;
  companiesCount: number;
  locationsCount: number;
  contactsCount: number;
  rejectionsCount: number;
  activitiesCount?: number;
  searchRunsCount?: number;
  sourceRecordsCount?: number;
  syncLogEntries: number;
  lastSync: string | null;
  state: "SYNCED" | "PENDING" | "ERROR" | "NEVER";
}

/**
 * A row from `GET /internal/ops/jobs` (the Jev research pipeline's job
 * list), shaped for the Searches pages. This replaces the old fixture
 * `SearchRun` type -- there is no Google Sheet tab backing search runs,
 * so this is sourced from the in-memory job list instead. It carries
 * less detail than the old mock `SearchRun` did: no `roles` (the job
 * list endpoint doesn't return the target-roles list it was started
 * with) and no `completedAt` (only a single `createdAt` timestamp is
 * tracked). See `apps/web/src/lib/api.ts::getJobs` and the Searches
 * pages for how the gap is handled in the UI.
 */
export interface JobRun {
  jobId: string;
  location: string;
  postcode: string;
  industry?: string | null;
  status: string; // includes "interrupted" when a service restart stopped an in-flight job
  companiesFound: number;
  contactsFound: number;
  createdAt: string;
  updatedAt?: string;
  roles?: string[];
  errorSummary?: string;
}

export interface CompanyActivity {
  activityId: string;
  companyId: string;
  contactId?: string | null;
  companyName?: string;
  activityType: "call" | "email" | "meeting" | "note";
  outcome?: string | null;
  notes: string;
  happenedAt: string;
  followUpAt?: string | null;
  followUpStatus?: "OPEN" | "COMPLETED" | string | null;
  followUpCompletedAt?: string | null;
  createdAt: string;
  syncStatus?: string;
}
