# Assistant guide screenshots

The chat assistant shows screenshots (`apps/web/public/guides/*.png`) under its
step-by-step answers. This folder regenerates them.

**They must come from fictional demo data, never the live Sheet** -- the live
Sheet holds the client's real customers and this repo is public.
`capture.mjs` refuses to run against a non-localhost URL, and
`demo_backend.py` forces mock mode before the app loads.

## Regenerate

1. Install Playwright somewhere outside the repo (`npm i playwright`); it uses
   the locally installed Google Chrome (`channel: "chrome"`).
2. Pick a throwaway secret and export it: `AUTH_JWT_SECRET=<random>`.
3. Temporarily create `apps/web/.env.local` with `AUTH_ALLOWED_EMAILS`,
   `AUTH_JWT_SECRET` (same value), `NEXT_PUBLIC_API_URL=http://localhost:8001`
   and dummy `SMTP_*` values; `npm run build && npm run start` in `apps/web`.
4. `python scripts/guides/demo_backend.py` (serves fictional data on :8001).
5. `PW_DIR=<dir containing node_modules/playwright> node scripts/guides/capture.mjs`
6. Delete `apps/web/.env.local` again.

Screenshot ids must match `services/research/app/services/assistant_guides.py`
(`Guide.shots`) and the captions in
`apps/web/src/components/shared/chat-rich-text.tsx`.
