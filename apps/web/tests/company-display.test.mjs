import assert from 'node:assert/strict';
import test from 'node:test';
import { companyDisplayName, hasCompanyName, isSearchDocument, groupCompanyLocations } from '../src/lib/company-display.ts';

test('display uses trimmed trading/legal names, then an honest ABN fallback', () => {
  assert.equal(companyDisplayName({ tradingName: '  ', companyName: ' Real Engineering ' }), 'Real Engineering');
  assert.equal(companyDisplayName({ tradingName: ' Steam Services ', companyName: 'Legal Ltd' }), 'Steam Services');
  assert.equal(companyDisplayName({ companyName: '', abn: '21527591972' }), 'ABN 21527591972');
  assert.equal(companyDisplayName(undefined), 'Company name unavailable');
  assert.equal(hasCompanyName({ companyName: '  ', abn: '21527591972' }), false);
});

test('document search results are flagged without treating client workbook titles as invalid companies', () => {
  assert.equal(isSearchDocument({ source: 'FIRECRAWL_SEARCH', companyName: '[PDF] Companies directory' }), true);
  assert.equal(isSearchDocument({ source: 'FIRECRAWL_SEARCH', website: 'https://example.invalid/list.pdf?x=1' }), true);
  assert.equal(isSearchDocument({ source: 'LEGACY_EXCEL', companyName: '[PDF] Client original source' }), false);
  assert.equal(isSearchDocument({ source: 'OVERTURE_MAPS', companyName: 'Engineering Ltd' }), false);
});

test('large groups retain every location but count each linked company once', () => {
  const rows = Array.from({length: 100}, (_, i) => ({locationId: `site-${i}`, companyId: `company-${i % 28}`, siteName: `Site ${i}`}));
  const grouped = groupCompanyLocations(rows);
  assert.equal(grouped.length, 28);
  assert.equal(grouped.reduce((total, row) => total + row.locations.length, 0), 100);
  assert.equal(new Set(grouped.flatMap(row => row.locations.map(loc => loc.locationId))).size, 100);
});
