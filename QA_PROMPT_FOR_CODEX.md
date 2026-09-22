# QA Prompt for Codex — Friction GenLead

Paste everything below into Codex CLI to run a full QA pass on this repo.

---

You are QA-testing **Friction GenLead**, a Queensland business prospecting system, at
`C:\Users\Asus\OneDrive - wsm llc\Documents\Friction GenLead` (also on GitHub at
https://github.com/Jeevan1811/Friction-GenLead, now public).

## What this system does

A user enters a QLD postcode. **Jev** (the operations engine,
`services/research/app/services/jev.py`) runs a 4-step pipeline — discover via ABR,
verify ABN + operating site, research contacts by crawling company websites, evaluate
industry fit — and produces a list of candidate companies and contacts. A human
reviews and approves/rejects each one in the dashboard; nothing is ever auto-approved.
A Llama 3.3 model via OpenRouter (`services/research/app/services/llm.py`) powers a
chat assistant sidebar for asking questions about the pipeline. Google Sheets is the
only persistent store (no SQL database) — that part is not yet wired to the UI.

## Architecture

- `apps/web/` — Next.js 15 + TypeScript + Tailwind v4, talks to the backend at
  `http://localhost:8001` (see `apps/web/src/lib/api.ts`)
- `services/research/` — FastAPI + Python 3.11, all endpoints under `/internal/*`
- `packages/contracts/` — shared TypeScript enums/types
- No database — Google Sheets integration exists (`services/research/app/services/sheets.py`)
  but isn't called from any router yet

## How to run it

```bash
# Terminal 1 — backend
cd services/research
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# Terminal 2 — frontend
npm install
npm run dev --workspace=apps/web
```

Open http://localhost:3000. No API keys are required to run — everything falls back
to mock/local behavior when unconfigured (see Known Gaps below).

## Non-negotiable rules to verify are actually enforced, not just claimed

Read `CLAUDE.md` in the repo root for the full list, but the ones most likely to be
silently violated by a careless change are:

1. **Human approval mandatory** — no code path may set a company/contact/location to
   APPROVED without a specific user action. Search for anywhere `APPROVED` is set and
   check it's behind an explicit approve click, never a side effect of discovery,
   verification, or evaluation.
2. **ABN ≠ operating site** — verifying a company's ABN must never by itself mark a
   *location* as verified. Check `jev.py`'s `_step_verify` only touches company-level
   fields, and location verification (`/internal/verify/location`) is separate.
3. **Jev failure never fails open** — every step in `jev.py` must route exceptions to
   `NEEDS_REVIEW`/warnings, never silently mark something verified/approved on error.
   Try to break this: feed a postcode that causes an ABR lookup exception, a website
   that times out, a malformed URL — confirm the job still completes with warnings
   rather than crashing or silently succeeding.
4. **Sheet write failure → "Pending", never fake "Synced"** — inspect
   `services/research/app/services/sheets.py`; this isn't wired to the UI yet, so
   confirm nothing in the current UI claims data is "Synced" without a real write path.
5. **No mass LinkedIn scraping** — confirm the crawler (`crawler.py`) only touches
   the company's own website, never a social network.
6. **SSRF protection on the crawler** — this is the one piece of genuine security
   surface in the app. Try to get `WebsiteCrawler.fetch()` to hit `127.0.0.1`,
   `169.254.169.254` (cloud metadata), `10.0.0.1`, a `file://` URL, and a domain that
   resolves via DNS rebinding to a private IP. All must raise `SSRFError` before any
   request goes out. Also confirm the 5MB response cap and 2s/domain rate limit
   actually apply (check `crawler.py`'s constants and enforcement functions).
7. **User-owned fields never overwritten** — Notes and Priority fields on a company
   must survive re-runs of discovery/verification for the same company.

## Functional test pass

### Backend (`services/research/`)
- `pip install -r requirements.txt` succeeds cleanly
- `python -m pytest app/services/resolver_test.py -v` — all tests pass
- `python -c "from app.main import app"` — imports without error, and
  `GET /openapi.json` lists all expected routes (health, discover, verify/company,
  verify/location, research/contacts, evaluate, import/*, chat, ops/*)
- `POST /internal/ops/research` with a valid QLD postcode (4000-4999) starts a job;
  an out-of-range or malformed postcode (e.g. `"2000"`, `"abc"`, `"12345"`) returns a
  422 with a clear validation error, not a 500
- Poll `GET /internal/ops/research/{job_id}` until `status` is `completed` — confirm
  all 4 steps reach `status: "completed"` (lowercase — this was a real bug found and
  fixed in this session, verify it stays fixed) and `companies_found`/`contacts_found`
  are consistent with `GET /internal/ops/research/{job_id}/results`
- `POST /internal/verify/company` with `{"companyId": "comp-test", "action": "approve"}`
  (camelCase, matching what the browser sends) returns `status: "APPROVED"` — this was
  also a real bug (schema expected a UUID with no alias) found and fixed this session
- `POST /internal/verify/company` with `action: "reject"` and a `reason` returns
  `status: "REJECTED"` with that reason in `notes`
- `POST /internal/chat` with no `OPENROUTER_API_KEY` set returns a clear "not
  configured" message rather than crashing or hanging; with `stream: true` returns an
  SSE stream terminating in `data: [DONE]`
- Malformed/missing fields on every POST endpoint return 4xx, never 5xx

### Frontend (`apps/web/`)
- `npx tsc --noEmit -p apps/web/tsconfig.json` — zero errors
- `npm run build --workspace=apps/web` succeeds
- **Search page** (`/search`): postcode validation rejects non-QLD postcodes inline
  before submit; submitting a valid search shows a toast, then a live "Research
  Progress" panel with 4 steps that individually flip from pending → running →
  completed (grey circle → spinning red circle → green check) as the backend job
  advances — don't just check the overall badge, check each step icon individually,
  since that's exactly where the case-mismatch bug was hiding
- **Companies page** (`/companies`): click a row to open the detail drawer; Approve
  and Reject buttons call the real backend (check the Network tab — should hit
  `/internal/verify/company`, not just mutate local state); Reject opens a confirm
  dialog asking for a reason before anything happens; after approve/reject, the tab
  counts (New/Needs Review/Approved/etc.) update correctly
- **Chat sidebar**: floating button bottom-right on every dashboard page; opens a
  panel, greeting message present; sending a message shows it right-aligned, then a
  "Thinking..." indicator, then the assistant's reply left-aligned; refresh the page
  — chat history persists (sessionStorage) within the same tab session but is empty
  in a fresh session/incognito
- Resize to mobile width (375px) — chat button, sidebar nav, and drawer all remain
  usable; nothing overlaps or goes off-screen
- All colors should visibly be the light theme with the red (#C8372D) "London
  Bridge" accent — if you see dark backgrounds, that's `prefers-color-scheme`
  leaking through and `data-theme="light"` in `apps/web/src/app/layout.tsx` isn't
  being respected

## Known gaps — do not report these as new bugs, but do confirm they're honestly
## surfaced to the user rather than silently faked

- ABR, contact extraction beyond `mailto:` links, and "operating site" verification
  all return realistic **mock data**, not live external API calls
- Google Sheets sync exists as a service but no router calls it — approve/reject
  currently only updates in-memory/local state, nothing persists across a backend
  restart
- No auth/login — anyone who can reach the dashboard can approve/reject
- In-memory job store in `jev.py` (`_jobs` dict) — restarting the backend loses all
  research job history

## Report format

For each issue found: file + line, what you did to trigger it, what happened vs.
what should have happened, and severity (breaks a non-negotiable rule above /
functional bug / cosmetic). Flag anything where the UI claims success but the backend
call actually failed silently — that's the failure mode this app is specifically
designed to avoid.
