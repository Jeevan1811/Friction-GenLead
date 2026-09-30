import type { Location } from './types';

type Identity = { companyName?: string | null; tradingName?: string | null; abn?: string | null; source?: string; website?: string };
const text = (value: string | null | undefined) => String(value ?? '').trim();

export function hasCompanyName(company: Identity | null | undefined): boolean {
  return Boolean(text(company?.tradingName) || text(company?.companyName));
}

export function companyDisplayName(company: Identity | null | undefined): string {
  return text(company?.tradingName) || text(company?.companyName)
    || (text(company?.abn) ? `ABN ${text(company?.abn)}` : 'Company name unavailable');
}

/** Flag old document search hits for review; never reinterpret workbook rows. */
export function isSearchDocument(company: Identity | null | undefined): boolean {
  return text(company?.source).toUpperCase() === 'FIRECRAWL_SEARCH'
    && (/^\[(?:PDF|DOCX?|XLSX?)\]/i.test(text(company?.companyName)) || /\.(?:pdf|docx?|xlsx?)(?:[?#]|$)/i.test(text(company?.website)));
}

export function groupCompanyLocations(locations: Location[]): { key: string; companyId: string; locations: Location[] }[] {
  const groups = new Map<string, { key: string; companyId: string; locations: Location[] }>();
  for (const row of locations) {
    const key = row.companyId || `location:${row.locationId}`;
    const group = groups.get(key) ?? { key, companyId: row.companyId, locations: [] };
    group.locations.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}
