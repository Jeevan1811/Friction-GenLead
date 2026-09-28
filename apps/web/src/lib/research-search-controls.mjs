export const COMPANY_TARGET_MIN = 10;
export const COMPANY_TARGET_MAX = 100;
export const COMPANY_TARGET_STEP = 1;
export const DEFAULT_COMPANY_TARGET = 30;
export const DEFAULT_SEARCH_SECTOR = "Valve-focused";

export const VALVE_SECTOR_OPTIONS = [
  {
    value: "Valve-focused",
    label: "Valve-focused (recommended)",
  },
  {
    value: "Engineering & Industrial Services",
    label: "Engineering & industrial services",
  },
  {
    value: "Steam & Boiler Operations",
    label: "Steam & boiler operations",
  },
  {
    value: "Food & Beverage Processing",
    label: "Food & beverage processing",
  },
  {
    value: "Water Utilities & Authorities",
    label: "Water utilities & authorities",
  },
];

export const OTHER_INDUSTRY_OPTIONS = [
  "Mining",
  "Energy",
  "Heavy Industry",
  "Construction",
  "Transport",
  "Manufacturing",
];

export function buildResearchRequestBody(
  location,
  industry,
  roles,
  maxCompanies = DEFAULT_COMPANY_TARGET,
) {
  return {
    location,
    industry: industry || null,
    roles: roles || [],
    max_companies: maxCompanies,
  };
}
