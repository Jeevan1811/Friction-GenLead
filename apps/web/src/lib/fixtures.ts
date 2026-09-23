/* ============================================================
   Formerly: fixture data for Friction GenLead — QLD industrial
   prospects.

   Every dashboard page used to render the mock arrays that lived in
   this file instead of real data. They've all been wired up to the
   live backend now (see `@/lib/api` for the fetch functions and
   `services/research/app/routers/data.py` for the FastAPI endpoints
   they call, which read from the Google Sheets adapter).

   The `Company`/`Location`/`Contact`/`RejectedEntity`/`SyncStatus`
   interfaces that used to live in this file, and were re-exported
   from here, have moved to `@/lib/types` -- they're still the
   correct shared contract, just no longer bundled with mock data.
   Import them from there.

   This file is kept (rather than deleted outright) as a landing
   spot for anyone still looking for the old fixtures; there is
   nothing left to import from it.
   ============================================================ */

export {};
