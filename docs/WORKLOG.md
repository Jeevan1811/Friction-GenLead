# Friction GenLead Worklog

## 2026-09-24 — SSRF redirect and streamed chat fixes (deployed)

- Truth labels: **Verified**, **DEPLOYED**.
- Repository: `C:\Users\Asus\OneDrive - wsm llc\Documents\Friction GenLead`.
- Branch: `codex/genlead-shipfix`, based on commit `19580033d23e817357a3719dc3f11a7e30fd2fcb`.
- Production baseline: commit `72754d9`; web and research API PM2 processes were online before this change.
- Release commits: `627b2c5` and `484f700`, pushed to `main` and pulled onto the VPS.
- Fixed crawler redirect ordering and pinned the validated DNS address at the TCP backend, closing both redirect-following and DNS-rebinding paths.
- Fixed streamed chat provider failures to return the built-in fallback and terminal SSE event without exposing partial output.
- Added regression tests. Confirmed RED before implementation and GREEN afterward.
- Verification: `python -m pytest -q` — **70 passed**; `git diff --check` — clean.
- Production runtime dependencies: HTTPX 0.28.1 and HTTPcore 1.0.9 satisfy the declared requirements.
- Production verification: `frictiongenlead-api` restarted and remained online; `/internal/health` returned 200; protected `/internal/data/companies` returned 401 without a session; a real crawler GET to `https://example.com/` returned 200 HTML.
- Removed and re-read to verify the four QA artifacts from the live Sheets tabs: two company rows (`comp-test`, `comp-test-2`), one location row (`loc-test`), and the matching rejection row.
- Existing uncommitted work in the user's original `main` worktree was left untouched and excluded from this branch.
- Unknown: inbox receipt and human completion of OTP remain unverified.
- Independent Claude security review was unavailable because organization policy disabled Claude Code subscription access; the configured router reported that boundary, and no bypass was attempted.
- Next owner: Jeevan / a mailbox user to confirm OTP receipt and complete a real setup/reset flow.

## 2026-09-25 — source archives synced; app readiness gaps confirmed

- User authorized preserving/syncing the Excel data. Per the supplied PDF, the cleaned Google Sheet remains the app's live record and the source workbook stays historical, so the raw workbooks were imported as clearly labeled native Google Sheets archives, separate from app-write tabs.
- The actual source workbooks under `C:\Users\Asus\OneDrive - wsm llc\Documents\Friction GenLead\scripts\migrate-legacy\data` match the audited snapshot byte-for-byte. SHA-256: master `331366136E82F293CEB55616494BBB3E09B90C8B815A4AF3B2CA8D052DB4D98C`; targets `A3373AE8F4040EFC924779ED2BEA075EFFD721081698555AD82BCC1ED73569DA`.
- Native archives: Master Customers `1OHOTEgtEgXfOt5oLwEW5HxNW38QbBYNss8mNSwyLMh8`; Customer Targets `1ksZc88skidpQuyB7NirjS3Ub_3HT8RWNSpNRFRcIwfs`. Compared every nonblank cell across all seven tabs, including source coordinates: 30,490 cells, zero mismatches. Confirmed tables `QLDContactsTable` A1:I3360 and `NewOceaniaContactsTable` A1:K90, plus Target workbook filter/sort metadata. Target/Sheet1 used-range extends to row 3,418 but populated values end at row 134; only the blank-only tail was not expanded.
- Renamed the live spreadsheet `Friction GenLead - MSV Live QLD Data` (ID `1LWY2AlvBGv9QRAb6gkFivw6rKVIg5Z0DsFLnF9glIkY`) and added `Source Archive Manifest` with links. Existing `Companies`, `Locations`, `Contacts`, `Rejected`, `SyncLog`, and staging rows were not edited. Canonical counts remain 4,199 / 6,331 / 1,707; prior full migration-projection checks still hold.
- Source-only values are now recoverable in archives but not searchable in canonical app tables: 347 landlines without a contact name, 470 verification/source cells, 311 raw financial suffix values, and one no-company postcode row (`Customers - Targets - QLD.xlsx`, `Master`, row 3569). Do not map these into user-owned notes without a field/meaning decision.
- Requirements QA against the 12-page PDF: Google Sheets persistence and manual approve/reject exist, but live postcode/company research does not—the ABR adapter and contact finder use mock/unconnected data. Generic company notes display, but call logging and follow-up scheduling are absent. Search jobs/history are in memory rather than Sheet-backed, so repeat-search suppression is not durable. **Not ship-ready as real lead generation** until real sources and durable follow-up/history behavior are implemented and verified.
- No app source, `.env`, VPS, or Drive permissions changed; no new application deployment was performed. Original `main` remains at `19580033d23e817357a3719dc3f11a7e30fd2fcb`, four commits behind origin with unrelated dirty changes intact.
- Next owner: Jeevan to select/authorize real ABR/contact sources and credentials, choose call-note/follow-up semantics, and confirm any direct Drive sharing with MSV. Codex to implement/test in `codex/genlead-shipfix`, then run release QA and deploy only approved app changes.

## 2026-09-25 — legacy workbook reconciliation (read-only)

- Truth labels: **VERIFIED** for mapped values in current live/staging tabs; **SOURCE-FIDELITY GAP** for identified raw workbook omissions.
- Re-parsed both legacy workbooks in the original `main` checkout and compared to the saved migration projection. Counts and row-accounting match after excluding generated `last_modified` timestamps: 4,199 companies, 6,331 locations, 1,707 contacts, and 10,156 logical source records.
- Read current `Companies`, `Locations`, `Contacts` and `_STAGING_*` tabs through Google Drive. Full row-value SHA-256 digests and ID-set digests matched the expected projection on all six tabs. No Google Sheet writes were made.
- Source rows: 13,507 data-row positions, including 3,791 blank/spacer rows; one nonblank no-company row is skipped (`Customers - Targets - QLD.xlsx`, `Master`, row 3569). The 441 second-list entries in `Master` are accounted for as additional logical records.
- Gaps proven in source/parser/writer: 347 landlines on company rows lacking a contact name are dropped; 470 nonempty `Verification / Source` cells are only in dry-run `verification_notes` and are not written to staging/live; 311 financial values appended to `Sheet3` names are stripped and not retained as values. Live schema also omits raw postcode, raw professional URL, migration provenance, and quality flags that remain in staging.
- Impact: current canonical rows exactly match the transformed projection, but this does **not** establish zero-loss source fidelity. Recovery requires the source workbooks and a clear destination for omitted fields.
- Prevention/closure: before any live data/schema migration, get owner direction on an audit/source tab versus adding fields to the live app schema, implement lossless mapping and a no-drop row invariant, then re-read and digest-verify every affected live/staging row. Do not modify live data until that decision is approved.
- Project code, source workbook files, and Google Sheets were not modified in this audit. Original `main` dirty changes remain untouched. Current release worktree: `codex/genlead-shipfix` at `3e951b256ee29ba786907f7f03c263537f70a829`; documentation changes are in that worktree only.

## 2026-09-25 — workflow implementation and final readiness status

- Truth: **IMPLEMENTED IN ISOLATED WORKTREE**; **NOT DEPLOYED**; **NOT READY** for real prospecting.
- Repo: `C:\Users\Asus\Documents\Codex\2026-09-23\for-x20\work\genlead-shipfix`, branch `codex/genlead-shipfix`, HEAD `3e951b256ee29ba786907f7f03c263537f70a829`; all current implementation changes remain uncommitted. The original shared `main` checkout and unrelated dirty files were left intact.
- Shipped in code (not production): Settings-accessible 9-step route-aware dashboard guide; activity/call/email/meeting/note logging; optional scheduled follow-ups with complete/reopen; follow-up list; Google Sheets adapters for `Activities` and `SearchRuns`; durable search summaries and interrupted-run recovery; honest unavailable/empty states.
- Made fake/disconnected research paths fail closed. No generated/sample businesses or contacts are represented as discovered/verified; research submit, contact discovery, scoring, and external verification remain unavailable until real providers exist. Human review decisions no longer imply external verification.
- Verification: `python -m pytest -q` — **81 passed**; Next production build — **passed**; web TypeScript check — **passed**; `npm audit` — **0 vulnerabilities**; `git diff --check` — no whitespace errors (line-ending warnings only). Browser click-through did not complete because the local web process could not be launched under the execution environment; UI behavior is build/test verified, not browser verified.
- No `.env` or secrets were inspected or edited, no SMTP/Hostinger password was changed, no production service or live Google Sheet was modified, and there was no push/deploy. The new Sheets tabs are not yet created in production.
- Remaining ship blockers: real ABR/company-source and contact-finder integrations; resolved production OTP mail delivery (earlier SMTP `535`) and a human test of code receipt/setup/login/reset; app-level access/mapping for the source-only fields identified in the workbook audit. Exact source values remain preserved in the two archive Sheets, with 30,490 nonblank source cells matched, but preservation in archives alone does not make all those fields available in GenLead.
- Next owner: Jeevan to supply/authorize a real prospecting provider and an approved working transactional-email sender. Then run real provider and inbox E2E QA; only after that should the isolated changes be promoted and deployed under the existing production authorization.

## 2026-09-25 — lossless source-data import and dashboard sync (supersedes earlier source-field gap)

- Truth: **LIVE SHEET DATA VERIFIED**, **APP DEPLOYED AND SMOKE-TESTED**, **NEW RESEARCH/OTP PROVIDERS STILL SEPARATE**.
- Applied `scripts/migrate-legacy/sync_source_records_to_live.py --apply` to the live MSV spreadsheet. It appended source fields and 10,157 raw `SourceRecords` rows (10,156 linked plus one unmatched). Read-back hash/row verification passed. Re-running the migration found all 10,157 already present, zero new rows, and zero conflicts.
- Existing canonical values and header order passed pre/post preservation checks. The import did not rewrite original workbook archive tabs, staging tabs, existing user notes or canonical values. All nonblank source cells (30,490 across the source workbooks) were already parity-checked against the native archive copies.
- Wired raw-source pagination/search and sync count through the API; canonical tables expose source-only landlines, verification/source text, financial suffixes, postcode, raw URL, provenance and quality flags. Added the Source Data screen, visible 30-second Sheets polling plus focus refresh, and navigation/help/tour links. Partial row updates now write only selected fields, protecting formulas and user-added columns.
- API adapter live-data checks: 10,157 rows, one unmatched row, searches for preserved source values succeed, sync status reports source rows. Backend tests: **84 passed**. `npm run build --workspace=apps/web`: passed, with type validation and `/source-data`, `/follow-ups`, `/settings` routes.
- Deployment baseline inspected: VPS app commit `3e951b2`; GenLead web/API PM2 processes online, bound to their app-specific ports behind `frictiongenlead.friction.com.my`. Production checkout has user-owned untracked `ecosystem.config.js`, venv, and SMTP backup; preserve them. Other PM2 apps are out of scope.
- Published commit `ca5a6fbb52f985378882d24aa38ac09ce3f56bda` on `codex/genlead-shipfix`; merged PR #1 as `72c7093851123ac263ecc7a1490c9c1aed0436e0`.
- Deployed only `/opt/frictiongenlead/app` and `frictiongenlead-web` / `frictiongenlead-api`; the VPS checkout is on `main` at `72c7093`. Existing untracked ecosystem config, virtualenv, SMTP backup, and all other PM2 apps were left untouched.
- `npm ci` completed with a non-blocking Cesium Node >=22 engine warning on the VPS's Node 20 runtime. The production Next build and type validation succeeded.
- Post-deploy smoke checks: both named PM2 processes online; API health `200`; public login `200`; protected `/source-data` redirects with `307`; unauthenticated `/internal/data/source-records` and `/internal/data/sync-status` return `401` as expected. No authenticated production browser session was available, so a live signed-in UI read after deployment remains unverified; adapter-backed reads against the actual Sheet passed before deploy.
- The deployed Sheet upgrade preserves/searches the existing Excel data and refreshes visible dashboard pages from Sheets every 30 seconds and on focus/return. It does not add an external real-company/contact provider or repair SMTP `535`; no SMTP settings/password were changed. These are separate from the source workbook data, which is now imported and accessible through the app's protected routes.
- Next: complete one authenticated `/source-data`/search/dashboard QA pass when a valid session is available; separately resolve SMTP delivery and decide whether to connect a paid/approved prospect research provider.
