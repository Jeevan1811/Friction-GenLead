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
