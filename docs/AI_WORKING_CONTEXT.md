# Friction GenLead AI Working Context

Last updated: 2026-09-24 (Asia/Singapore)

## Repository and release state

- Repository: `C:\Users\Asus\OneDrive - wsm llc\Documents\Friction GenLead`
- Working branch: `codex/genlead-shipfix`
- Application commits: `627b2c5` (redirect ordering and streamed chat fallback), `484f700` (pin connections to validated DNS addresses)
- Branch base: `19580033d23e817357a3719dc3f11a7e30fd2fcb` (local main, including the committed postcode centroid helper)
- Production before this fix: `72754d9` on `31.97.70.50`, PM2 app user `frictiongenlead`
- Production after this fix: `484f700` on `main`; research API restarted, health returned 200, unauthenticated data access returned 401, and a real crawler GET to `https://example.com/` returned 200.
- The original `main` worktree has unrelated uncommitted migration and UI changes. They were not copied into this branch or changed.
- Deployment status: deployed and verified. A documentation-only follow-up may advance the repository HEAD without changing app code.

## Verified findings and changes in progress

- Verified: crawler previously allowed HTTPX to follow redirects before checking redirect destinations, and its separate HTTPX DNS lookup left a rebinding window.
- Fixed in `627b2c5` and `484f700`: redirects are followed manually; every destination is validated before its request, and the validated IPs are pinned at the TCP connection layer. Redirects are limited to five hops; HTTPX environment proxies are disabled for crawler requests.
- Verified: an LLM error during streamed chat returned an empty SSE body and omitted `[DONE]`.
- Fixed in `627b2c5`: bounded provider output is buffered so a midstream provider failure can return the built-in guide answer and `[DONE]` without exposing a partial answer.
- Live Google Sheets QA rows created during the earlier audit were removed and their absence verified: `comp-test`, `comp-test-2`, `loc-test`, and the rejection entry for `comp-test-2`.
- Test-driven evidence: redirect ordering and streamed chat failure tests failed before their fixes; the pinned-network-backend test failed before the DNS pinning implementation. All pass after implementation.
- Backend verification: `python -m pytest -q` completed with 70 passed before deployment. Production has `httpx 0.28.1` and `httpcore 1.0.9`, within the declared dependency bounds.

## Limits and next owner

- Real mailbox delivery and OTP completion still require a human with access to the recipient inbox. A prior production reset request returned 200; this confirms the app's mail send call succeeded, not that a person read the message.
- Independent Claude security review was blocked because the organization disabled Claude Code subscription access; no permission bypass was attempted.
- Next owner: Jeevan / a mailbox user to confirm receipt and completion of an OTP. Codex can handle follow-up fixes if the human inbox test finds an issue.

## 2026-09-25 — source workbook archive conversion and ship-readiness QA

- Truth labels: **VERIFIED** for source-cell preservation in native Google Sheets archives and existing canonical counts; **NOT READY TO SHIP** for the full MSV prospecting workflow; **UNKNOWN** for MSV's direct Drive access (no sharing changes were made).
- Reviewed all 12 pages of `C:\Users\Asus\Downloads\Precision_Prospecting_Workflow.pdf`. It calls for the cleaned Google Sheet to remain the app's live record and the original workbook to remain historical/untouched; it also specifies real postcode-to-company research, multi-source verification, human approval, contact-role discovery, avoiding repeat searches, and call follow-up/notes.
- The actual project data files and audited snapshot are byte-identical. Master workbook SHA-256: `331366136E82F293CEB55616494BBB3E09B90C8B815A4AF3B2CA8D052DB4D98C`; Targets workbook SHA-256: `A3373AE8F4040EFC924779ED2BEA075EFFD721081698555AD82BCC1ED73569DA`.
- Imported both originals as native historical Google Sheets, leaving local Excel files untouched: Master Customers (`https://docs.google.com/spreadsheets/d/1OHOTEgtEgXfOt5oLwEW5HxNW38QbBYNss8mNSwyLMh8/edit`) and Customer Targets (`https://docs.google.com/spreadsheets/d/1ksZc88skidpQuyB7NirjS3Ub_3HT8RWNSpNRFRcIwfs/edit`). All seven tabs were checked by bounded ranges: 30,490 nonblank cells match in value and source position, with zero differences. Native tables `QLDContactsTable` A1:I3360 and `NewOceaniaContactsTable` A1:K90, plus Target workbook filter/sort metadata, were preserved. Targets/Sheet1 has 3,418 used-range rows but only 134 populated rows; the import has 1,000 grid rows, so only the blank trailing extent was not expanded.
- Renamed the existing live spreadsheet to `Friction GenLead - MSV Live QLD Data` (`https://docs.google.com/spreadsheets/d/1LWY2AlvBGv9QRAb6gkFivw6rKVIg5Z0DsFLnF9glIkY/edit`) and added `Source Archive Manifest` with per-sheet counts, source hashes, parity results, and archive links. Existing app and staging data tabs were not rewritten.
- Canonical counts remain 4,199 companies, 6,331 locations, and 1,707 contacts; prior full-row/ID digest checks against the migration projection passed. Archives retain source values absent from normalized app tables: 347 landlines without contact names, 470 `Verification / Source` cells, 311 raw financial suffix values in `Sheet3`, and the postcode-only/no-company row at Targets/Master row 3569. These are preserved in the archive, not yet searchable app fields.
- Product gaps verified in release worktree `codex/genlead-shipfix` at `3e951b256ee29ba786907f7f03c263537f70a829`: postcode research still returns mock companies (`services/research/app/services/abr.py`); UI warns results are samples; no real contact finder is connected. Company `notes` display, but there is no call activity/follow-up date/reminder workflow. Search jobs/history are in memory, not durable across restart. The full MSV workflow is therefore not ready to ship as real lead generation.
- No app code, `.env`, VPS service, or Drive permissions were changed; no new application deploy was performed. Original `main` remains at `19580033d23e817357a3719dc3f11a7e30fd2fcb`, four commits behind origin with prior unrelated dirty changes intact.
- Next owner: Jeevan to choose/authorize real company/contact sources and credentials, decide the call-follow-up interaction, and confirm whether the archives should be directly shared with MSV. Codex can implement and test the app work in the release worktree before a separately verified deployment.

## 2026-09-25 — legacy workbook reconciliation

- Truth labels: **VERIFIED** for current live/staging values versus the saved migration projection; **SOURCE-FIDELITY GAP** for raw workbook fields not represented in those tabs.
- Read-only scope: the two source workbooks and migration artifacts under `C:\Users\Asus\OneDrive - wsm llc\Documents\Friction GenLead\scripts\migrate-legacy\data`; current Google Sheet tabs `Companies`, `Locations`, `Contacts`, and their three `_STAGING_*` counterparts. Original `main` worktree remained untouched.
- Re-parsed the current workbooks with `migrate.py`. Entity counts and row accounting match `migration_dry_run.json` after excluding generated `last_modified` timestamps: 4,199 companies, 6,331 locations, 1,707 contacts; 10,156 logical source records.
- Read all six current tabs and compared full row-value SHA-256 digests against the expected staged and live projections. All ID-set digests, counts, and row-value digests matched; no live data was written.
- Row accounting: 13,513 used-range row positions; 6 headers; 13,507 data-row positions; 3,791 blank/spacer rows; 9,715 primary company records plus 441 additional side-by-side company records. One nonblank source row with no company name is skipped at `Customers - Targets - QLD.xlsx`, `Master`, row 3569.
- Confirmed raw-source omissions: 347 business landlines on rows with no contact name are dropped by `assemble`; 470 populated `Verification / Source` values are collected into dry-run-only `verification_notes` but not written by `write_staging_to_sheets.py`; 311 `Sheet3` financial suffix values are stripped while only a warning flag survives. These fields do not appear in live or staging tabs.
- `raw_postcode`, `professional_url_raw`, provenance, and quality flags are present in staging but excluded from live canonical schemas. Thus live tabs match the migration projection, but the import is not lossless against every source cell.
- No workbook, application code, or Google Sheet was changed. Before repairing these gaps, owner direction is needed on whether raw values should remain in a dedicated audit/source tab or be added to the live GenLead schema/UI.

## 2026-09-25 — workflow implementation and release boundary

- Truth labels: **IMPLEMENTED IN ISOLATED WORKTREE** for interactive dashboard guidance, persistent activity/follow-up workflows, and durable search-run summaries; **VERIFIED** for automated tests/build/security audit; **NOT READY TO SHIP AS REAL PROSPECTING** because real company/contact providers and working OTP delivery are still missing.
- Worktree: `C:\Users\Asus\Documents\Codex\2026-09-23\for-x20\work\genlead-shipfix`; branch `codex/genlead-shipfix`; base/HEAD remains `3e951b256ee29ba786907f7f03c263537f70a829`. Changes are uncommitted and isolated. Original OneDrive `main` checkout and its dirty work were not touched.
- Implemented: a route-aware 9-step dashboard tour that can be restarted from Settings; Google-Sheets-backed activity records and scheduled follow-ups with complete/reopen behavior; search-run summary persistence and interrupted-run recovery; explicit honest empty/source states. Company activity notes survive a failed write, and the API reports saved only after a live Sheets write succeeds.
- Safety correction: disconnected/mock ABR discovery, contact research, scoring, and verification now fail closed instead of presenting sample records as real. Human approval is labeled as user evidence, not as externally verified business data. New-company research submission responds unavailable until a real source is connected.
- Added `Activities` and `SearchRuns` tab definitions/adapters. These are code-only in this worktree; production Sheets have not been changed and will require the API's tab-creation path when a future approved deployment starts.
- Verification recorded: Python backend suite **81 passed**; web production build and TypeScript typecheck succeeded; `npm audit` reported **0 vulnerabilities**; `git diff --check` had no whitespace errors (only Windows line-ending warnings). Browser automation was not completed because the local web-server process launch was blocked; do not claim live UI click-through for this change.
- No `.env`, credential export, VPS service, live application Sheet, or external account was read/changed in this pass. No commit, push, or deployment was performed.
- Blocking release gaps: (1) no real ABR/company discovery or contact-finder provider, so prospecting is intentionally disabled; (2) production SMTP previously returned `535`, no reusable working sender was established, and no password reset or credential was changed; (3) no real inbox OTP setup/reset pass; (4) source-only workbook values remain recoverable in archives but not queryable in canonical app fields (347 landlines, 470 source/verification cells, 311 raw suffix values, plus one postcode-only row).
- Next owner: Jeevan to authorize/connect real company and contact data providers and provide a working transactional-email route without exposing credentials in chat. After those exist, Codex can run real provider/API/inbox QA, deploy only with current explicit authorization, verify the newly created Sheet tabs and PM2 health, and re-check source-field parity.

## 2026-09-25 — source-data upgrade and live-sheet sync (supersedes earlier sheet-gap status)

- Truth labels: **LIVE SHEET IMPORT VERIFIED**; **APP DEPLOYED AND SMOKE-TESTED**; **PROSPECTING/OTP PROVIDER GAPS REMAIN SEPARATE**.
- Scope: implement the planned Sheet upgrade so every source row/value is retained and searchable in GenLead, and dashboard pages refresh from the live Google Sheet. The two original Excel workbooks and their historical archive tabs remain untouched.
- Live spreadsheet: `Friction GenLead - MSV Live QLD Data` (`1LWY2AlvBGv9QRAb6gkFivw6rKVIg5Z0DsFLnF9glIkY`). Append-only/idempotent migration wrote and read-back verified 10,157 `SourceRecords` rows (10,156 linked, one unmatched). Existing canonical rows/values/order passed pre/post checks; only source-data columns were appended. The original archives and staging tabs were not overwritten.
- Source fidelity: all original nonblank values, including landlines without named contacts, verification/source values, financial suffixes, raw postcodes/URLs, provenance, quality flags, and the postcode-only unmatched row, are available in the raw source-record archive and applicable canonical search fields. The re-run is idempotent: 10,157 already imported, zero pending, zero conflicts.
- App changes: commit `ca5a6fbb52f985378882d24aa38ac09ce3f56bda`, merged as `72c7093851123ac263ecc7a1490c9c1aed0436e0` via [PR #1](https://github.com/Jeevan1811/Friction-GenLead/pull/1). Header-name-based Sheets reads, append-only schema extension, non-destructive partial cell writes, protected paginated source-record search, sync count, source-data UI, and visible-page/focus refresh (30-second interval) are included, along with Sheet-backed search/follow-up/activity features, Settings-startable dashboard guide, and fail-closed sample research paths.
- API verification against live Sheets adapter: 10,157 source rows returned; unmatched row visible; searches find source-only values; sync status exposes the source-row count. Backend suite: 84 passed. Next.js production build/typecheck passed, including `/source-data`, `/follow-ups`, and `/settings` routes.
- VPS deployment verified: `31.97.70.50`, `/opt/frictiongenlead/app`, `main` at `72c7093`; only `frictiongenlead-web` and `frictiongenlead-api` were restarted. Both PM2 processes are online; API `/internal/health` returned 200; public `/login` returned 200; `/source-data` redirects unauthenticated users to login; protected source-record and sync-status endpoints return 401 without a session. Existing untracked production files (`ecosystem.config.js`, virtualenv and SMTP backup) were preserved.
- Production build passed on the VPS. `npm ci` emitted a non-blocking engine warning because Cesium packages request Node >=22 while this host uses Node 20. The Next production build completed successfully. No authenticated production session was available for a post-deploy row-level browser check; the same live Sheet adapter and protected endpoints were verified before deployment.
- This Sheet-sync release does not create a real third-party prospect/contact data provider and does not fix the previously observed SMTP `535`; no SMTP credentials were changed. These are separate from preserving, searching and refreshing MSV's existing real workbook data. Do not describe the complete external research/email workflow as ready until separately integrated and tested.
- Next owner: Jeevan to arrange a working transactional-email sender and approve a real prospect/contact research provider if he wants new outbound research. Then complete the real inbox OTP flow and an authenticated dashboard/source-data QA pass. Those are distinct from the now-deployed preservation and live-Sheet refresh work.
