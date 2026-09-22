/* ============================================================
   Fixture data for Friction GenLead — QLD industrial prospects
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
}

export interface RejectedEntity {
  entityId: string;
  entityType: "company" | "location" | "contact";
  entityName: string;
  reason: string;
  rejectedBy: string;
  rejectedAt: string;
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

export interface SyncStatus {
  state: string;
  lastSync?: string;
  companiesCount: number;
  locationsCount: number;
  contactsCount: number;
  errors: string[];
}

/* ---------- Companies ---------- */
export const companies: Company[] = [
  {
    companyId: "co-001",
    abn: "54 078 848 674",
    companyName: "CS Energy Ltd",
    normalizedName: "cs energy",
    tradingName: "CS Energy",
    website: "https://www.csenergy.com.au",
    industry: "Energy",
    abnStatus: "Active",
    status: "APPROVED",
    industryFit: "TARGET",
    priority: 1,
    source: "ABR",
    lastVerified: "2026-09-15",
    lastModified: "2026-09-15",
  },
  {
    companyId: "co-002",
    abn: "37 078 848 674",
    companyName: "Stanwell Corporation Limited",
    normalizedName: "stanwell corporation",
    tradingName: "Stanwell",
    website: "https://www.stanwell.com",
    industry: "Energy",
    abnStatus: "Active",
    status: "REVIEW",
    industryFit: "TARGET",
    priority: 2,
    source: "ABR",
    lastVerified: "2026-09-10",
    lastModified: "2026-09-12",
  },
  {
    companyId: "co-003",
    abn: "44 003 442 341",
    companyName: "Downer EDI Limited",
    normalizedName: "downer edi",
    tradingName: "Downer",
    website: "https://www.downergroup.com",
    industry: "Mining Services",
    abnStatus: "Active",
    status: "NEW",
    industryFit: "TARGET",
    priority: 3,
    source: "PUBLIC_SEARCH",
    lastModified: "2026-09-18",
  },
  {
    companyId: "co-004",
    abn: "87 000 069 223",
    companyName: "Thiess Pty Ltd",
    normalizedName: "thiess",
    tradingName: "Thiess",
    website: "https://www.thiess.com",
    industry: "Mining Services",
    abnStatus: "Active",
    status: "VERIFYING",
    industryFit: "TARGET",
    priority: 4,
    source: "ABR",
    lastVerified: "2026-09-05",
    lastModified: "2026-09-08",
  },
  {
    companyId: "co-005",
    abn: "31 073 369 203",
    companyName: "Sun Metals Corporation Pty Ltd",
    normalizedName: "sun metals",
    tradingName: "Sun Metals",
    website: "https://www.sunmetals.com.au",
    industry: "Manufacturing",
    abnStatus: "Active",
    status: "APPROVED",
    industryFit: "ADJACENT",
    priority: 5,
    source: "ABR",
    lastVerified: "2026-09-01",
    lastModified: "2026-09-01",
  },
  {
    companyId: "co-006",
    abn: "61 078 848 549",
    companyName: "Ergon Energy Corporation Limited",
    normalizedName: "ergon energy",
    tradingName: "Ergon Energy",
    website: "https://www.ergon.com.au",
    industry: "Energy",
    abnStatus: "Active",
    status: "STALE",
    industryFit: "TARGET",
    priority: 6,
    source: "ABR",
    lastVerified: "2026-06-15",
    lastModified: "2026-06-15",
    notes: "Needs re-verification — contact data may be outdated",
  },
  {
    companyId: "co-007",
    abn: "79 068 474 271",
    companyName: "Gladstone Ports Corporation Limited",
    normalizedName: "gladstone ports",
    tradingName: "GPC",
    website: "https://www.gpcl.com.au",
    industry: "Transport",
    abnStatus: "Active",
    status: "APPROVED",
    industryFit: "ADJACENT",
    priority: 7,
    source: "ABR",
    lastVerified: "2026-08-20",
    lastModified: "2026-08-20",
  },
  {
    companyId: "co-008",
    abn: "14 146 335 622",
    companyName: "Aurizon Holdings Limited",
    normalizedName: "aurizon",
    tradingName: "Aurizon",
    website: "https://www.aurizon.com.au",
    industry: "Transport",
    abnStatus: "Active",
    status: "REJECTED",
    industryFit: "UNLIKELY",
    source: "PUBLIC_SEARCH",
    lastModified: "2026-09-02",
    notes: "Corporate HQ only — no operational site in target postcode",
  },
];

/* ---------- Locations ---------- */
export const locations: Location[] = [
  {
    locationId: "loc-001",
    companyId: "co-001",
    siteName: "Callide Power Station",
    locationType: "PLANT",
    address: "Callide Dam Rd",
    suburb: "Callide",
    state: "QLD",
    postcode: "4715",
    verificationStatus: "VERIFIED",
    lastVerified: "2026-09-15",
    lastModified: "2026-09-15",
  },
  {
    locationId: "loc-002",
    companyId: "co-001",
    siteName: "Kogan Creek Power Station",
    locationType: "PLANT",
    address: "Condamine Hwy",
    suburb: "Brigalow",
    state: "QLD",
    postcode: "4412",
    verificationStatus: "VERIFIED",
    lastVerified: "2026-09-15",
    lastModified: "2026-09-15",
  },
  {
    locationId: "loc-003",
    companyId: "co-002",
    siteName: "Stanwell Power Station",
    locationType: "PLANT",
    address: "Stanwell Power Station Rd",
    suburb: "Stanwell",
    state: "QLD",
    postcode: "4702",
    verificationStatus: "VERIFIED",
    lastVerified: "2026-09-10",
    lastModified: "2026-09-10",
  },
  {
    locationId: "loc-004",
    companyId: "co-003",
    siteName: "Downer Brendale Depot",
    locationType: "DEPOT",
    address: "14 Leitchs Rd",
    suburb: "Brendale",
    state: "QLD",
    postcode: "4500",
    verificationStatus: "UNVERIFIED",
    lastModified: "2026-09-18",
  },
  {
    locationId: "loc-005",
    companyId: "co-004",
    siteName: "Thiess South Brisbane Office",
    locationType: "OFFICE",
    address: "179 Grey St",
    suburb: "South Brisbane",
    state: "QLD",
    postcode: "4101",
    verificationStatus: "VERIFYING",
    lastModified: "2026-09-08",
  },
  {
    locationId: "loc-006",
    companyId: "co-005",
    siteName: "Sun Metals Zinc Refinery",
    locationType: "PLANT",
    address: "Stuart Dr",
    suburb: "Stuart",
    state: "QLD",
    postcode: "4811",
    verificationStatus: "VERIFIED",
    lastVerified: "2026-09-01",
    lastModified: "2026-09-01",
  },
  {
    locationId: "loc-007",
    companyId: "co-006",
    siteName: "Ergon Energy Townsville Office",
    locationType: "OFFICE",
    address: "420 Flinders St",
    suburb: "Townsville",
    state: "QLD",
    postcode: "4810",
    verificationStatus: "VERIFIED",
    lastVerified: "2026-06-15",
    lastModified: "2026-06-15",
  },
  {
    locationId: "loc-008",
    companyId: "co-007",
    siteName: "Gladstone Port Terminal",
    locationType: "PLANT",
    address: "40 Goondoon St",
    suburb: "Gladstone",
    state: "QLD",
    postcode: "4680",
    verificationStatus: "VERIFIED",
    lastVerified: "2026-08-20",
    lastModified: "2026-08-20",
  },
  {
    locationId: "loc-009",
    companyId: "co-008",
    siteName: "Aurizon Callemondah Rail Yard",
    locationType: "DEPOT",
    address: "Red Rover Rd",
    suburb: "Callemondah",
    state: "QLD",
    postcode: "4680",
    verificationStatus: "DISPUTED",
    lastModified: "2026-09-02",
  },
];

/* ---------- Contacts ---------- */
export const contacts: Contact[] = [
  {
    contactId: "ct-001",
    companyId: "co-001",
    locationId: "loc-001",
    name: "Brett Hawkins",
    position: "Plant Manager",
    roleBucket: "Operations",
    rolePriority: "PRIORITY",
    businessEmail: "b.hawkins@csenergy.com.au",
    mobile: "0412 345 678",
    contactStatus: "APPROVED",
    lastVerified: "2026-09-15",
    lastModified: "2026-09-15",
  },
  {
    contactId: "ct-002",
    companyId: "co-001",
    locationId: "loc-001",
    name: "Karen Mitchell",
    position: "Procurement Manager",
    roleBucket: "Procurement",
    rolePriority: "PRIORITY",
    businessEmail: "k.mitchell@csenergy.com.au",
    contactStatus: "VERIFIED",
    lastVerified: "2026-09-15",
    lastModified: "2026-09-15",
  },
  {
    contactId: "ct-003",
    companyId: "co-002",
    locationId: "loc-003",
    name: "David Chen",
    position: "Operations Manager",
    roleBucket: "Operations",
    rolePriority: "PRIORITY",
    businessEmail: "d.chen@stanwell.com",
    mobile: "0423 456 789",
    contactStatus: "NEW",
    lastModified: "2026-09-12",
  },
  {
    contactId: "ct-004",
    companyId: "co-003",
    locationId: "loc-004",
    name: "Sarah Thompson",
    position: "Engineering Manager",
    roleBucket: "Engineering",
    rolePriority: "PRIORITY",
    businessEmail: "s.thompson@downergroup.com",
    contactStatus: "NEW",
    lastModified: "2026-09-18",
  },
  {
    contactId: "ct-005",
    companyId: "co-004",
    locationId: "loc-005",
    name: "Michael O'Brien",
    position: "Site Manager",
    roleBucket: "Operations",
    rolePriority: "PRIORITY",
    businessEmail: "m.obrien@thiess.com",
    mobile: "0434 567 890",
    contactStatus: "VERIFIED",
    lastVerified: "2026-09-05",
    lastModified: "2026-09-08",
  },
  {
    contactId: "ct-006",
    companyId: "co-005",
    locationId: "loc-006",
    name: "James Wu",
    position: "Maintenance Manager",
    roleBucket: "Maintenance",
    rolePriority: "PRIORITY",
    businessEmail: "j.wu@sunmetals.com.au",
    contactStatus: "APPROVED",
    lastVerified: "2026-09-01",
    lastModified: "2026-09-01",
  },
  {
    contactId: "ct-007",
    companyId: "co-005",
    locationId: "loc-006",
    name: "Rachel Nguyen",
    position: "Safety Manager",
    roleBucket: "Safety",
    rolePriority: "SECONDARY",
    businessEmail: "r.nguyen@sunmetals.com.au",
    contactStatus: "APPROVED",
    lastVerified: "2026-09-01",
    lastModified: "2026-09-01",
  },
  {
    contactId: "ct-008",
    companyId: "co-006",
    locationId: "loc-007",
    name: "Tony Ferguson",
    position: "Fleet Manager",
    roleBucket: "Fleet",
    rolePriority: "SECONDARY",
    businessEmail: "t.ferguson@ergon.com.au",
    contactStatus: "STALE",
    lastVerified: "2026-06-15",
    lastModified: "2026-06-15",
  },
  {
    contactId: "ct-009",
    companyId: "co-007",
    locationId: "loc-008",
    name: "Lisa Patel",
    position: "General Manager",
    roleBucket: "Operations",
    rolePriority: "PRIORITY",
    businessEmail: "l.patel@gpcl.com.au",
    mobile: "0445 678 901",
    contactStatus: "APPROVED",
    lastVerified: "2026-08-20",
    lastModified: "2026-08-20",
  },
  {
    contactId: "ct-010",
    companyId: "co-007",
    locationId: "loc-008",
    name: "Mark Williams",
    position: "Logistics Manager",
    roleBucket: "Logistics",
    rolePriority: "SECONDARY",
    businessEmail: "m.williams@gpcl.com.au",
    contactStatus: "VERIFIED",
    lastVerified: "2026-08-20",
    lastModified: "2026-08-20",
  },
];

/* ---------- Search Runs ---------- */
export const searchRuns: SearchRun[] = [
  {
    searchId: "sr-001",
    postcode: "4680",
    industry: "Heavy Industry",
    roles: ["Plant Manager", "Operations Manager", "Procurement Manager"],
    status: "completed",
    startedAt: "2026-09-20T09:30:00Z",
    completedAt: "2026-09-20T09:45:00Z",
    companiesFound: 3,
    contactsFound: 4,
  },
  {
    searchId: "sr-002",
    postcode: "4810",
    industry: "Energy",
    roles: ["General Manager", "Maintenance Manager"],
    status: "completed",
    startedAt: "2026-09-19T14:00:00Z",
    completedAt: "2026-09-19T14:12:00Z",
    companiesFound: 2,
    contactsFound: 3,
  },
  {
    searchId: "sr-003",
    postcode: "4715",
    industry: "Energy",
    roles: ["Plant Manager", "Engineering Manager", "Site Manager"],
    status: "running",
    startedAt: "2026-09-22T08:00:00Z",
    companiesFound: 1,
    contactsFound: 0,
  },
  {
    searchId: "sr-004",
    postcode: "4500",
    industry: "Mining Services",
    roles: ["Operations Manager"],
    status: "failed",
    startedAt: "2026-09-18T16:30:00Z",
    companiesFound: 0,
    contactsFound: 0,
  },
];

/* ---------- Rejected Entities ---------- */
export const rejectedEntities: RejectedEntity[] = [
  {
    entityId: "co-008",
    entityType: "company",
    entityName: "Aurizon Holdings Limited",
    reason: "Corporate HQ only — no operational site in target postcode",
    rejectedBy: "Jeevan K",
    rejectedAt: "2026-09-02T11:00:00Z",
  },
  {
    entityId: "loc-009",
    entityType: "location",
    entityName: "Aurizon Callemondah Rail Yard",
    reason: "Location data disputed — address not confirmed",
    rejectedBy: "Jeevan K",
    rejectedAt: "2026-09-02T11:05:00Z",
  },
];

/* ---------- Sync Status ---------- */
export const syncStatus: SyncStatus = {
  state: "SYNCED",
  lastSync: "2026-09-22T07:30:00Z",
  companiesCount: 7,
  locationsCount: 8,
  contactsCount: 10,
  errors: [],
};

/* ---------- Helpers ---------- */
export function getCompanyLocations(companyId: string): Location[] {
  return locations.filter((l) => l.companyId === companyId);
}

export function getCompanyContacts(companyId: string): Contact[] {
  return contacts.filter((c) => c.companyId === companyId);
}

export function getLocationContacts(locationId: string): Contact[] {
  return contacts.filter((c) => c.locationId === locationId);
}

export function getBestContact(companyId: string): Contact | undefined {
  const companyContacts = getCompanyContacts(companyId);
  return (
    companyContacts.find((c) => c.rolePriority === "PRIORITY") ??
    companyContacts[0]
  );
}

export function getLocationForCompany(companyId: string): Location | undefined {
  return locations.find((l) => l.companyId === companyId);
}
