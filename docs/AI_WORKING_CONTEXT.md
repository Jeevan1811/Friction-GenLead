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
