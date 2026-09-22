export const PRIORITY_ROLES = [
  "Owner",
  "Managing Director",
  "General Manager",
  "Plant Manager",
  "Operations Manager",
  "Maintenance Manager",
  "Engineering Manager",
  "Procurement Manager",
  "Purchasing Manager",
  "Commercial Director",
  "Site Manager",
  "Mine Manager",
] as const;

export const SECONDARY_ROLES = [
  "Safety Manager",
  "Environmental Manager",
  "Project Manager",
  "Workshop Manager",
  "Fleet Manager",
  "Supply Chain Manager",
  "Logistics Manager",
  "Technical Manager",
  "Quality Manager",
  "HR Manager",
] as const;

export type PriorityRole = (typeof PRIORITY_ROLES)[number];
export type SecondaryRole = (typeof SECONDARY_ROLES)[number];
