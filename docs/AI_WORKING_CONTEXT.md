# Friction GenLead AI Working Context

Last updated: 2026-09-24 (Asia/Singapore)

## Repository and release state

- Repository: `C:\Users\Asus\OneDrive - wsm llc\Documents\Friction GenLead`
- Working branch: `codex/genlead-shipfix`
- Branch base: `19580033d23e817357a3719dc3f11a7e30fd2fcb` (local main, including the committed postcode centroid helper)
- Production before this fix: `72754d9` on `31.97.70.50`, PM2 app user `frictiongenlead`
- The original `main` worktree has unrelated uncommitted migration and UI changes. They were not copied into this branch or changed.
- Deployment status: pending final commit and VPS verification.

## Verified findings and changes in progress

- Verified: crawler previously allowed HTTPX to follow redirects before checking redirect destinations.
- Fix in progress: redirects are followed manually; every resolved destination is validated before its request, with a five-redirect limit.
- Verified: an LLM error during streamed chat returned an empty SSE body and omitted `[DONE]`.
- Fix in progress: bounded provider output is buffered so a midstream provider failure can return the built-in guide answer and `[DONE]` without exposing a partial answer.
- Live Google Sheets QA rows created during the earlier audit were removed and their absence verified: `comp-test`, `comp-test-2`, `loc-test`, and the rejection entry for `comp-test-2`.
- Test-driven evidence: both regression tests failed before the implementation and pass after it.
- Backend verification: `python -m pytest -q` completed with 69 passed.

## Limits and next owner

- Real mailbox delivery and OTP completion still require a human with access to the recipient inbox. A prior production reset request returned 200; this confirms the app's mail send call succeeded, not that a person read the message.
- Next owner: Codex to finish release commit, deploy to the VPS, then record the verified production revision and health checks here and in `docs/WORKLOG.md`.
