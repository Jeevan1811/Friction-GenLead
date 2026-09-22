import type {
  CompanyStatus,
  ContactStatus,
  EvidenceSource,
  IndustryFit,
  LocationStatus,
  LocationType,
  ReliabilityTier,
  RolePriority,
  SyncState,
} from "./enums";

export interface Company {
  companyId: string;
  abn: string;
  companyName: string;
  normalizedName: string;
  tradingName?: string;
  website?: string;
  industry?: string;
  abnStatus?: string;
  status: CompanyStatus;
  industryFit: IndustryFit;
  priority?: number;
  source: EvidenceSource;
  lastVerified?: string;
  lastModified: string;
  notes?: string;
}

export interface Location {
  locationId: string;
  companyId: string;
  siteName: string;
  locationType: LocationType;
  address?: string;
  suburb?: string;
  state: string;
  postcode: string;
  lat?: number;
  lng?: number;
  verificationStatus: LocationStatus;
  lastVerified?: string;
  lastModified: string;
}

export interface Contact {
  contactId: string;
  companyId: string;
  locationId?: string;
  name: string;
  position?: string;
  roleBucket?: string;
  rolePriority: RolePriority;
  businessEmail?: string;
  mobile?: string;
  landline?: string;
  professionalUrl?: string;
  contactStatus: ContactStatus;
  lastVerified?: string;
  lastModified: string;
}

export interface RejectedEntity {
  entityId: string;
  entityType: "company" | "location" | "contact";
  entityName: string;
  reason: string;
  rejectedBy: string;
  rejectedAt: string;
  originalData: Record<string, unknown>;
}

export interface SearchRun {
  searchId: string;
  postcode: string;
  industry?: string;
  roles: string[];
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  companiesFound: number;
  contactsFound: number;
}

export interface Evidence {
  source: EvidenceSource;
  reliability: ReliabilityTier;
  url?: string;
  snippet?: string;
  collectedAt: string;
}

export interface EvidencePack {
  entityId: string;
  entityType: "company" | "location" | "contact";
  evidence: Evidence[];
}

export interface SyncStatus {
  state: SyncState;
  lastSync?: string;
  companiesCount: number;
  locationsCount: number;
  contactsCount: number;
  errors: string[];
}

export interface SearchInput {
  postcode: string;
  industry?: string;
  roles: string[];
}

export interface CompanyWithRelations extends Company {
  locations: Location[];
  contacts: Contact[];
  evidence?: Evidence[];
}
