import type { Company, Contact } from "./types";

export const CONTACT_STATUS_FILTERS = [
  { value: "ALL", label: "All statuses" },
  { value: "APPROVED", label: "Accepted" },
  { value: "NEW", label: "Needs review" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
  { value: "STALE", label: "Stale" },
  { value: "LEFT_COMPANY", label: "Left company" },
] as const;

export type ContactStatusFilter = (typeof CONTACT_STATUS_FILTERS)[number]["value"];

type ContactFilters = {
  priorityFilter: string;
  statusFilter: ContactStatusFilter;
  searchQuery: string;
};

export function filterContacts(
  contacts: Contact[],
  companyById: ReadonlyMap<string, Company>,
  filters: ContactFilters,
): Contact[] {
  const query = filters.searchQuery.trim().toLowerCase();

  return contacts.filter((contact) => {
    if (filters.priorityFilter !== "ALL" && contact.rolePriority !== filters.priorityFilter) {
      return false;
    }

    if (filters.statusFilter !== "ALL" && contact.contactStatus !== filters.statusFilter) {
      return false;
    }

    if (!query) return true;

    const company = companyById.get(contact.companyId);
    const searchFields = [
      contact.name,
      contact.position,
      contact.professionalUrlRaw,
      contact.landline,
      contact.mobile,
      company?.companyName,
      company?.tradingName,
      contact.businessEmail,
    ];

    return searchFields.some((value) => String(value ?? "").toLowerCase().includes(query));
  });
}
