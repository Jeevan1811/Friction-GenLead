"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Company, Location } from '@/lib/types';
import { companyDisplayName, groupCompanyLocations, hasCompanyName } from '@/lib/company-display';
import { DetailDrawer } from './detail-drawer';
import { InfoPopover } from './info-popover';

type Origin = 'saved' | 'prospect' | 'unknown';
const labels = { saved: 'From MSV’s workbook', prospect: 'Public-source prospect', unknown: 'Source not recorded' };
const pageSize = 20;

export function MapLocationBrowser({ locations, companiesById, origins, onClose }: {
  locations: Location[];
  companiesById: ReadonlyMap<string, Company>;
  origins: ReadonlyMap<string, Origin>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState('all');
  const [page, setPage] = useState(0);
  const groups = useMemo(() => groupCompanyLocations(locations), [locations]);
  const filtered = useMemo(() => groups.filter(group => {
    const company = companiesById.get(group.companyId);
    if (origin !== 'all' && (origins.get(group.companyId) ?? 'unknown') !== origin) return false;
    const words = [companyDisplayName(company), company?.abn, ...group.locations.flatMap(row => [row.siteName, row.address, row.suburb, row.state, row.postcode, row.country])];
    return words.some(word => String(word ?? '').toLowerCase().includes(query.trim().toLowerCase()));
  }), [groups, companiesById, origins, origin, query]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const shown = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <DetailDrawer open onClose={onClose} title="Companies in this map group">
    <div className="genlead-map-browser-heading">
      <span>{groups.length.toLocaleString()} {groups.length === 1 ? 'company' : 'companies'} / {locations.length.toLocaleString()} {locations.length === 1 ? 'location' : 'locations'}</span>
      <InfoPopover label="Map groups" text="Nearby map points are grouped at the current zoom. They may represent different addresses. Approximate postcode centres are not exact company locations. Search and source filters only change this panel; no Sheet data is changed." />
    </div>
    <div className="genlead-map-browser-filters">
      <input className="input-field" type="search" aria-label="Search companies in map group" placeholder="Company or postcode" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <select className="input-field" aria-label="Map group source" value={origin} onChange={event => { setOrigin(event.target.value); setPage(0); }}>
        <option value="all">All sources</option><option value="saved">MSV’s workbook</option><option value="prospect">New prospects</option><option value="unknown">Source not recorded</option>
      </select>
    </div>
    <div className="genlead-map-browser-list">
      {shown.map(group => {
        const company = companiesById.get(group.companyId);
        const source = origins.get(group.companyId) ?? 'unknown';
        const first = group.locations[0];
        const address = (row: Location) => [row.address, row.suburb, row.state, row.postcode, row.country].filter(Boolean).join(', ');
        const site = (row: Location) => <div key={row.locationId} className="genlead-map-browser-site">
          {row.siteName && row.siteName !== companyDisplayName(company) && <span>{row.siteName}</span>}
          <span>{address(row) || 'Address not recorded'}</span>
          {row.coordinateSource === 'POSTCODE_CENTROID' && <small>Approximate postcode centre</small>}
        </div>;
        return <article className="genlead-map-browser-company" key={group.key}>
          <h3>{companyDisplayName(company)}</h3>
          {!hasCompanyName(company) && <small>Name not recorded in the Sheet</small>}
          <span className={`genlead-map-origin-badge genlead-map-origin-badge--${source}`}>{labels[source]}</span>
          {site(first)}
          {group.locations.length > 1 && <details><summary>{group.locations.length - 1} more {group.locations.length === 2 ? 'site' : 'sites'}</summary>{group.locations.slice(1).map(site)}</details>}
          {company ? <Link className="genlead-map-popup-link" href={`/companies?companyId=${encodeURIComponent(group.companyId)}`}>View company</Link> : <small>Company record unavailable</small>}
        </article>;
      })}
      {!shown.length && <p role="status">No companies match these filters.</p>}
    </div>
    {filtered.length > pageSize && <nav className="genlead-map-browser-pagination" aria-label="Map group pages">
      <button className="btn-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span>Page {currentPage + 1} of {lastPage + 1}</span>
      <button className="btn-secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
    </nav>}
  </DetailDrawer>;
}
