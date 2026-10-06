import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTACT_STATUS_FILTERS, filterContacts } from '../src/lib/contact-filters.ts';

const contacts = [
  { contactId: 'c-1', companyId: 'co-1', name: 'Alex Rivers', position: 'Plant Manager', businessEmail: 'alex@example.test', rolePriority: 'PRIORITY', contactStatus: 'APPROVED' },
  { contactId: 'c-2', companyId: 'co-2', name: 'Sam Lee', position: 'Engineer', businessEmail: 'sam@example.test', rolePriority: 'SECONDARY', contactStatus: 'NEW' },
  { contactId: 'c-3', companyId: 'co-1', name: 'Jamie Park', position: 'Operations Lead', rolePriority: 'PRIORITY', contactStatus: 'REJECTED' },
];

const companies = new Map([
  ['co-1', { companyId: 'co-1', companyName: 'Wacol Steam Works', tradingName: 'Steam Works' }],
  ['co-2', { companyId: 'co-2', companyName: 'Northside Process', tradingName: '' }],
]);

const runFilter = (overrides = {}) => filterContacts(contacts, companies, {
  priorityFilter: 'ALL',
  statusFilter: 'ALL',
  searchQuery: '',
  ...overrides,
});

test('the Accepted filter maps only to the stored APPROVED contact status', () => {
  const acceptedOption = CONTACT_STATUS_FILTERS.find((option) => option.label === 'Accepted');
  assert.equal(acceptedOption?.value, 'APPROVED');
  assert.deepEqual(runFilter({ statusFilter: 'APPROVED' }).map((contact) => contact.contactId), ['c-1']);
  assert.deepEqual(runFilter().map((contact) => contact.contactId), ['c-1', 'c-2', 'c-3']);
});

test('status, role priority, and search filters compose without hiding matches', () => {
  assert.deepEqual(runFilter({ statusFilter: 'APPROVED', priorityFilter: 'PRIORITY' }).map((contact) => contact.contactId), ['c-1']);
  assert.deepEqual(runFilter({ statusFilter: 'APPROVED', priorityFilter: 'SECONDARY' }), []);
  assert.deepEqual(runFilter({ searchQuery: 'steam works' }).map((contact) => contact.contactId), ['c-1', 'c-3']);
  assert.deepEqual(runFilter({ statusFilter: 'APPROVED', searchQuery: 'alex@example.test' }).map((contact) => contact.contactId), ['c-1']);
});

test('the visible status filter covers every canonical contact status', () => {
  assert.deepEqual(
    CONTACT_STATUS_FILTERS.map((option) => option.value),
    ['ALL', 'APPROVED', 'NEW', 'VERIFIED', 'REJECTED', 'STALE', 'LEFT_COMPANY'],
  );
});
