"""Knowledge base for the GenLead assistant.

Single source of truth for "how does this app work". It feeds two things:

1. The AI system prompt (see assistant.py) -- the model answers from this.
2. A deterministic fallback -- if the AI provider is down, the assistant can
   still return the matching guide, so "how do I ...?" never dead-ends.

Everything here must match what the app really does. If a feature is not
built, say so plainly (see ``LIMITATIONS``) rather than describing it as if
it exists.

Screenshots are served from ``apps/web/public/guides/<id>.png``; a guide's
``shots`` lists the ids that illustrate it. Paths in ``open`` must be real
routes (validated in assistant.py against ``KNOWN_PATHS``).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Guide:
    id: str
    title: str
    keywords: tuple[str, ...]
    summary: str
    steps: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()
    open: tuple[str, str] | None = None  # (path, button label)
    shots: tuple[str, ...] = field(default_factory=tuple)


OVERVIEW = """\
Friction GenLead is a Queensland industrial prospecting workspace. It keeps \
your customers and target companies, the sites (locations) they operate, and \
the people (contacts) to talk to -- all stored in a Google Sheet that you and \
the dashboard share.

Company -> Location -> Contact: a company can have several locations (plant, \
mine, office, depot, project), and each location can have contacts.

Pages (left sidebar): Search, Companies, Locations, Contacts, Searches, Rejected.
Human approval is always required: nothing is approved or rejected \
automatically -- a person clicks Approve or Reject.
"""

LIMITATIONS = """\
Be honest about these -- do not describe them as working:
- Automated postcode research (the Search page, "Start Research") currently \
runs on SAMPLE data. The Australian Business Register (ABR) lookup and the \
website contact finder are not connected to the real services yet, so the \
companies and contacts it produces are demonstration examples, not real \
prospects. Real customer/target data lives on the Companies, Locations and \
Contacts pages (imported from the client's Excel files).
- Research results are not saved to the Sheet and the Searches history is \
cleared whenever the server restarts.
- There is no "Add company" / "Edit" form, no export button and no undo for \
Reject yet. To add or change details, edit the Google Sheet directly; to get \
a file, use File > Download in Google Sheets.
- The Locations map is empty because the imported sites have no map \
coordinates yet.
- The assistant cannot click buttons or change data for the user; it explains \
and points to the right page.
"""

GUIDES: tuple[Guide, ...] = (
    Guide(
        id="getting-started",
        title="Getting started / what can I do here?",
        keywords=("start", "begin", "overview", "what is", "what can", "help", "how does", "how it works",
                  "guide", "tour", "learn", "new here", "first time using", "explain the app", "end to end"),
        summary=("GenLead keeps your customers and targets in one place: Companies (who), "
                 "Locations (where) and Contacts (who to call), backed by a Google Sheet."),
        steps=(
            "Use the left sidebar to move between Search, Companies, Locations, Contacts, Searches and Rejected.",
            "Open Companies to browse everyone in the database; click a company to see its sites and contacts.",
            "Review records and click Approve or Reject -- your decision is saved to the Google Sheet.",
            "Anything you change directly in the Google Sheet shows up in the dashboard within about 15 seconds of refreshing.",
        ),
        notes=("The green 'Synced' dot in the sidebar means the dashboard is connected to the Google Sheet.",),
        open=("/companies", "Open Companies"),
        shots=("companies-list",),
    ),
    Guide(
        id="find-company",
        title="Find a company",
        keywords=("find", "search", "look up", "lookup", "locate", "where is", "company", "companies", "filter",
                  "browse", "tab", "sort", "page", "next page"),
        summary="Use the search box and tabs on the Companies page.",
        steps=(
            "Open Companies from the sidebar.",
            "Type part of the company name (or trading name) in 'Search companies...'.",
            "Use the tabs above the table (All, New, Needs Review, Approved, Stale, No Contact, Rejected) to narrow the list.",
            "Click a column heading (Company, Site / Postcode, Status) to sort. The list shows 50 companies per page -- use Next / Previous under the table.",
            "Click any row to open the company's details.",
        ),
        notes=("The quick search box at the top (or Ctrl/Cmd + K) also jumps to pages and actions.",),
        open=("/companies", "Open Companies"),
        shots=("companies-list", "companies-search"),
    ),
    Guide(
        id="company-details",
        title="See a company's details, sites and contacts",
        keywords=("details", "detail", "drawer", "contacts for", "who works", "sites", "information", "info", "profile"),
        summary="Clicking a company opens a side panel with its info, locations and contacts.",
        steps=(
            "On the Companies page, click the company's row.",
            "The panel shows Company Info (ABN, status, industry), its Locations, and its Contacts with position, email and phone.",
            "Each location and contact has its own Approve and Reject buttons; the company itself has them at the bottom.",
            "Close the panel with the X or the Escape key.",
        ),
        open=("/companies", "Open Companies"),
        shots=("companies-detail",),
    ),
    Guide(
        id="approve-reject",
        title="Approve or reject a company, location or contact",
        keywords=("approve", "approving", "approval", "reject", "rejecting", "verify", "review", "decision", "accept", "decline", "confirm", "mark",
                  "queue", "needs review", "remove", "delete", "not relevant"),
        summary="Open the record, then click Approve or Reject. Your decision is saved to the Google Sheet.",
        steps=(
            "Open Companies and click the company to open its panel.",
            "Check the details. To decide on the company itself, use Approve or Reject at the bottom of the panel; "
            "for a single site or person, use the buttons on that location or contact card.",
            "Approve marks the company APPROVED (a location VERIFIED, a contact APPROVED).",
            "Reject asks for a reason. The record is marked REJECTED (a location DISPUTED) and is added to the Rejected page with your reason.",
            "A message appears confirming the result, and shows whether it was saved to the Sheet ('Synced') or is still 'Pending' if the save failed.",
        ),
        notes=(
            "Approve/Reject only changes the status -- the rest of the record is left untouched.",
            "There is no undo button yet. To reverse a decision, change the status in the Google Sheet.",
        ),
        open=("/companies", "Open Companies"),
        shots=("approve-reject", "companies-detail"),
    ),
    Guide(
        id="locations",
        title="Browse locations (sites)",
        keywords=("location", "locations", "site", "sites", "address", "mine", "plant", "depot", "office",
                  "map", "grid", "postcode", "suburb", "where"),
        summary="The Locations page lists every site, as cards or a table, with search and filters.",
        steps=(
            "Open Locations from the sidebar.",
            "Search by site name, suburb, postcode or company; use the Type and Status drop-downs to filter.",
            "Switch between card view and table view with the two icons on the right of the toolbar.",
            "Use Next / Previous under the list (50 sites per page).",
        ),
        notes=("The map is empty for now because the imported sites do not have map coordinates yet.",),
        open=("/locations", "Open Locations"),
        shots=("locations",),
    ),
    Guide(
        id="contacts",
        title="Browse and use contacts",
        keywords=("contact", "contacts", "person", "people", "email", "phone", "mobile", "call", "manager",
                  "who should i", "priority contact", "role", "position"),
        summary="The Contacts page lists every person with position, priority, email and phone.",
        steps=(
            "Open Contacts from the sidebar.",
            "Search by name, position, company or email; use All / Priority / Secondary / Other to filter by importance.",
            "Click an email address to write to them or a phone number to call.",
            "PRIORITY contacts are the decision-makers to talk to first (e.g. Plant, Maintenance, Purchasing, Operations, Mine managers).",
        ),
        open=("/contacts", "Open Contacts"),
        shots=("contacts",),
    ),
    Guide(
        id="rejected",
        title="The Rejected page",
        keywords=("rejected", "rejections", "declined", "removed", "history of rejections", "undo", "restore", "bring back"),
        summary="Every rejected company, location or contact is listed here with the reason.",
        steps=(
            "Open Rejected from the sidebar.",
            "Each row shows what was rejected, why, who rejected it and when.",
        ),
        notes=("There is no restore button yet. To bring a record back, change its status in the Google Sheet.",),
        open=("/rejected", "Open Rejected"),
        shots=("rejected",),
    ),
    Guide(
        id="research",
        title="Start a research search for a postcode",
        keywords=("research", "a research", "run research", "start research", "research for", "research a", "new search", "postcode search", "discover", "prospect", "find new",
                  "search page", "jev", "abr", "pipeline", "generate leads", "new leads"),
        summary="The Search page runs an automated research job for a Queensland postcode -- but it currently uses SAMPLE data.",
        steps=(
            "Open Search from the sidebar.",
            "Enter a 4-digit Queensland postcode (4000-4999), optionally pick an industry and the target roles.",
            "Click Start Research. Progress shows as the job runs; finished jobs appear under Recent Searches and on the Searches page.",
        ),
        notes=(
            "IMPORTANT: the automated research currently produces sample/demo companies and contacts -- the "
            "Australian Business Register lookup and website contact finder are not connected yet. Do not treat these results as real prospects.",
            "Search results are not saved to the Sheet, and the Searches history resets when the server restarts.",
        ),
        open=("/search", "Open Search"),
        shots=("search",),
    ),
    Guide(
        id="sheet-sync",
        title="How the Google Sheet and dashboard stay in sync",
        keywords=("sheet", "google sheet", "spreadsheet", "sync", "synced", "pending", "excel", "edit the sheet",
                  "update the sheet", "change data", "add company", "add a company", "edit company", "edit", "import",
                  "add data", "new company", "correct", "fix", "update", "edit a company", "change a company",
                  "update a company", "website", "wrong", "incorrect", "change the"),
        summary="The Google Sheet is the database. The dashboard reads from it and writes decisions back to it.",
        steps=(
            "The Sheet has tabs: Companies, Locations, Contacts, Rejected and SyncLog. Tabs starting with _STAGING_ are the original import kept as a backup -- ignore them.",
            "To correct or add details, edit the row directly in the Google Sheet. Refresh the dashboard: changes appear within about 15 seconds.",
            "To add a new company, add a row to the Companies tab with a unique company_id, then link its location and contact rows using the same company_id.",
            "Don't rename tabs, reorder or delete columns, or remove the header row -- the dashboard depends on them.",
            "The sidebar shows 'Synced' when connected. If a save ever fails you'll see 'Pending' instead -- it is never shown as synced unless it really saved.",
        ),
        notes=("The Notes and Priority columns belong to you -- the system never overwrites them.",),
        open=("/companies", "Open Companies"),
        shots=("sheet-sync",),
    ),
    Guide(
        id="statuses",
        title="What the statuses and labels mean",
        keywords=("status", "statuses", "new", "stale", "verifying", "disputed", "unverified", "meaning", "mean",
                  "label", "badge", "priority", "secondary", "target", "adjacent", "fit", "closed", "inactive"),
        summary="Statuses show where each record is in review.",
        steps=(
            "Company: NEW = just imported / not yet reviewed; VERIFYING = checks under way; REVIEW = needs a person to look; "
            "APPROVED = confirmed good; REJECTED = not wanted; STALE = information may be out of date; INACTIVE = no longer trading; ERROR = something failed.",
            "Location: UNVERIFIED = not confirmed; VERIFYING = checking; VERIFIED = confirmed as a real operating site; CLOSED = no longer operating; DISPUTED = address/site is doubtful (also what Reject sets).",
            "Contact: NEW = not reviewed; VERIFIED / APPROVED = confirmed; REJECTED = don't use; STALE = may be out of date; LEFT_COMPANY = has moved on.",
            "Contact priority: PRIORITY = key decision-makers; SECONDARY = useful supporting roles; OTHER = everyone else.",
            "Industry fit (Companies): TARGET = strong match; ADJACENT = partial match; UNLIKELY / EXCLUDED = poor match.",
        ),
        notes=("Everything imported from the Excel files starts as NEW because none of it has been reviewed in the dashboard yet.",),
        open=("/companies", "Open Companies"),
    ),
    Guide(
        id="imported-data",
        title="About the imported customer data",
        keywords=("import", "imported", "migration", "migrated", "excel", "legacy", "where did", "source", "duplicate",
                  "duplicates", "missing", "blank", "no abn", "no contact", "postcode missing", "data quality", "accuracy"),
        summary="The database was built from the client's two Excel files (Master QLD Customers and Customers - Targets - QLD).",
        steps=(
            "The import produced one record per company, plus its sites and contacts, with duplicates merged.",
            "Many older records have no ABN, no contact or no full address -- the Excel files didn't have them. 'No Contact' tab on Companies lists those.",
            "If a postcode in the Excel looked like a phone number it was left blank rather than guessed.",
            "LinkedIn links from the Excel were not verified, so they are not shown as trusted links.",
            "Check and correct records as you review them -- edit the Google Sheet or approve/reject in the dashboard.",
        ),
        open=("/companies", "Open Companies"),
    ),
    Guide(
        id="account",
        title="Signing in, passwords and signing out",
        keywords=("login", "log in", "sign in", "password", "forgot", "reset", "code", "otp", "verification",
                  "logout", "log out", "sign out", "account", "access", "security", "locked", "cant login", "can't log in"),
        summary="Sign in with your email and password, then enter the 6-digit code emailed to you.",
        steps=(
            "Go to the sign-in page, enter your email and password, and click Continue.",
            "Enter the 6-digit code emailed to you (it expires after 5 minutes) and click 'Verify & sign in'.",
            "First time, or forgot your password? Click 'First time / forgot password?', enter your email, then enter the emailed code and choose a new password (8+ characters).",
            "To sign out, click your avatar (top right) and choose Log out. You stay signed in for 7 days otherwise.",
        ),
        notes=("Only approved email addresses can sign in -- there is no public sign-up. Too many wrong attempts temporarily locks sign-in.",),
        shots=("login",),
    ),
)

KNOWN_PATHS = frozenset({"/search", "/companies", "/locations", "/contacts", "/searches", "/rejected"})
KNOWN_SHOTS = frozenset(s for g in GUIDES for s in g.shots)


def render_for_prompt() -> str:
    """The knowledge base as plain text for the AI system prompt."""
    parts = ["ABOUT THE APP\n" + OVERVIEW, "KNOWN LIMITATIONS\n" + LIMITATIONS, "GUIDES"]
    for g in GUIDES:
        lines = [f"### {g.title}  [id: {g.id}]", g.summary]
        for i, step in enumerate(g.steps, 1):
            lines.append(f"{i}. {step}")
        for note in g.notes:
            lines.append(f"Note: {note}")
        if g.open:
            lines.append(f"Link marker to use: [[open:{g.open[0]}|{g.open[1]}]]")
        if g.shots:
            lines.append("Screenshot markers available: " + ", ".join(f"[[shot:{s}]]" for s in g.shots))
        parts.append("\n".join(lines))
    return "\n\n".join(parts)
