export const CompanyStatus = {
  NEW: "NEW",
  VERIFYING: "VERIFYING",
  REVIEW: "REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  STALE: "STALE",
  INACTIVE: "INACTIVE",
  ERROR: "ERROR",
} as const;
export type CompanyStatus = (typeof CompanyStatus)[keyof typeof CompanyStatus];

export const LocationStatus = {
  UNVERIFIED: "UNVERIFIED",
  VERIFYING: "VERIFYING",
  VERIFIED: "VERIFIED",
  CLOSED: "CLOSED",
  DISPUTED: "DISPUTED",
} as const;
export type LocationStatus = (typeof LocationStatus)[keyof typeof LocationStatus];

export const ContactStatus = {
  NEW: "NEW",
  VERIFIED: "VERIFIED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  STALE: "STALE",
  LEFT_COMPANY: "LEFT_COMPANY",
} as const;
export type ContactStatus = (typeof ContactStatus)[keyof typeof ContactStatus];

export const EvidenceSource = {
  ABR: "ABR",
  QLD_PLS: "QLD_PLS",
  AUSPOST: "AUSPOST",
  OFFICIAL_WEBSITE: "OFFICIAL_WEBSITE",
  PUBLIC_SEARCH: "PUBLIC_SEARCH",
  LEGACY_EXCEL: "LEGACY_EXCEL",
  PROJECT_REPORT: "PROJECT_REPORT",
  USER: "USER",
} as const;
export type EvidenceSource = (typeof EvidenceSource)[keyof typeof EvidenceSource];

export const ReliabilityTier = {
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  E: "E",
} as const;
export type ReliabilityTier = (typeof ReliabilityTier)[keyof typeof ReliabilityTier];

export const RolePriority = {
  PRIORITY: "PRIORITY",
  SECONDARY: "SECONDARY",
  OTHER: "OTHER",
} as const;
export type RolePriority = (typeof RolePriority)[keyof typeof RolePriority];

export const LocationType = {
  PLANT: "PLANT",
  MINE: "MINE",
  OFFICE: "OFFICE",
  PROJECT: "PROJECT",
  DEPOT: "DEPOT",
  OTHER: "OTHER",
} as const;
export type LocationType = (typeof LocationType)[keyof typeof LocationType];

export const SyncState = {
  SYNCED: "SYNCED",
  PENDING: "PENDING",
  ERROR: "ERROR",
  NEVER: "NEVER",
} as const;
export type SyncState = (typeof SyncState)[keyof typeof SyncState];

export const IndustryFit = {
  TARGET: "TARGET",
  ADJACENT: "ADJACENT",
  UNLIKELY: "UNLIKELY",
  EXCLUDED: "EXCLUDED",
} as const;
export type IndustryFit = (typeof IndustryFit)[keyof typeof IndustryFit];

export const SiteEvidence = {
  CONFIRMED: "CONFIRMED",
  LIKELY: "LIKELY",
  UNCERTAIN: "UNCERTAIN",
  DISPROVEN: "DISPROVEN",
} as const;
export type SiteEvidence = (typeof SiteEvidence)[keyof typeof SiteEvidence];

export const EntityMatch = {
  EXACT: "EXACT",
  FUZZY: "FUZZY",
  MANUAL: "MANUAL",
  NONE: "NONE",
} as const;
export type EntityMatch = (typeof EntityMatch)[keyof typeof EntityMatch];
