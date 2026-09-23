"""GenLead assistant: grounding, prompt assembly and no-AI fallback.

The model is only as good as what we put in front of it, so each question is
answered from three sources, in this order of trust:

1. The knowledge base (assistant_guides.py) -- how the app works.
2. Live data from the Google Sheet -- totals, plus the specific companies /
   contacts / postcodes the user's question mentions.
3. The model's own wording -- it is told not to add facts beyond 1 and 2.

If the AI provider is unavailable the assistant still answers "how do I ...?"
from the knowledge base and "how many / who is ..." from the live data.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from .assistant_guides import (
    GUIDES,
    KNOWN_PATHS,
    KNOWN_SHOTS,
    render_for_prompt,
)
from .sheets_instance import sheets_adapter

MAX_DATA_CHARS = 6500
MAX_SHOTS_PER_ANSWER = 2

_WORD = re.compile(r"[a-z0-9]+")
_POSTCODE = re.compile(r"\b(4\d{3})\b")

# Words that appear in thousands of company names -- never a reason on their
# own to think the user is asking about a specific company.
_NAME_STOPWORDS = frozenset({
    "pty", "ltd", "limited", "the", "and", "of", "qld", "queensland", "co", "company", "group",
    "services", "service", "australia", "australian", "holdings", "pl", "inc", "trust", "trading", "as",
})
_GENERIC_SINGLE = frozenset({
    "industrial", "mining", "mine", "engineering", "construction", "transport", "energy", "power",
    "metal", "steel", "electrical", "mechanical", "civil", "building", "supply", "supplies", "north",
    "south", "east", "west", "central", "brisbane", "coast", "gold", "bulk", "coal", "gas", "water",
    "equipment", "products", "systems", "solutions", "safety", "manager", "management", "sales",
})

_ROLE_PHRASES = (
    "plant manager", "maintenance manager", "purchasing manager", "procurement manager",
    "operations manager", "general manager", "managing director", "mine manager", "site manager",
    "engineering manager", "environmental manager", "project manager", "technical manager",
    "safety manager", "fleet manager", "logistics manager", "quality manager", "owner",
)


def _tokens(text: str) -> list[str]:
    return _WORD.findall((text or "").lower())


@dataclass
class DataContext:
    """What we know from the live Sheet that is relevant to one question."""

    overview: str = ""
    matches: list[str] = field(default_factory=list)  # question-specific facts
    ok: bool = True  # False if the Sheet couldn't be read

    def render(self) -> str:
        text = self.overview
        if self.matches:
            text += "\n\nRELEVANT TO THIS QUESTION\n" + "\n\n".join(self.matches)
        return text[:MAX_DATA_CHARS]


def _val(row: dict[str, Any], key: str) -> str:
    v = row.get(key)
    return str(v).strip() if v not in (None, "") else ""


async def build_context(question: str, page: str | None = None) -> DataContext:
    try:
        companies = await sheets_adapter.read_companies()
        locations = await sheets_adapter.read_locations()
        contacts = await sheets_adapter.read_contacts()
        rejected = await sheets_adapter.read_rejected()
    except Exception:  # noqa: BLE001 -- the assistant must still answer without data
        return DataContext(overview="(Live data is unavailable right now.)", ok=False)

    co_by_id = {_val(c, "company_id"): c for c in companies}
    locs_by_co: dict[str, list[dict]] = {}
    for loc in locations:
        locs_by_co.setdefault(_val(loc, "company_id"), []).append(loc)
    cts_by_co: dict[str, list[dict]] = {}
    for ct in contacts:
        cts_by_co.setdefault(_val(ct, "company_id"), []).append(ct)

    # --- overview -----------------------------------------------------------
    status_counts = Counter(_val(c, "status") or "UNKNOWN" for c in companies)
    prio_counts = Counter(_val(c, "role_priority") or "unset" for c in contacts)
    postcode_counts = Counter(
        _val(l, "postcode") for l in locations if _val(l, "postcode")
    )
    no_contact = sum(1 for c in companies if not cts_by_co.get(_val(c, "company_id")))
    no_abn = sum(1 for c in companies if not _val(c, "abn"))
    no_postcode = sum(1 for l in locations if not _val(l, "postcode"))

    overview = "LIVE DATA (from the Google Sheet right now)\n"
    overview += (
        f"- {len(companies)} companies, {len(locations)} locations, {len(contacts)} contacts, "
        f"{len(rejected)} rejected records.\n"
        f"- Company status: " + ", ".join(f"{k} {v}" for k, v in status_counts.most_common()) + ".\n"
        f"- Contact priority: " + ", ".join(f"{k} {v}" for k, v in prio_counts.most_common()) + ".\n"
        f"- {no_contact} companies have no contact; {no_abn} have no ABN; {no_postcode} locations have no postcode.\n"
        f"- Busiest postcodes (locations): "
        + ", ".join(f"{p} ({n})" for p, n in postcode_counts.most_common(8))
        + ".\n"
    )
    if page:
        overview += f"- The user is currently on the {page} page.\n"

    ctx = DataContext(overview=overview)
    q_lower = question.lower()
    q_tokens = set(_tokens(question))

    # --- companies named in the question -----------------------------------
    scored: list[tuple[int, dict]] = []
    for c in companies:
        name = _val(c, "normalized_name") or _val(c, "company_name")
        toks = [t for t in _tokens(name) if t not in _NAME_STOPWORDS]
        if not toks or not all(t in q_tokens for t in toks):
            continue
        if len(toks) == 1 and (len(toks[0]) < 4 or toks[0] in _GENERIC_SINGLE):
            continue
        scored.append((len(toks), c))
    scored.sort(key=lambda x: -x[0])
    for _, c in scored[:4]:
        cid = _val(c, "company_id")
        lines = [
            f"**{_val(c, 'company_name')}** -- status {_val(c, 'status') or 'unknown'}, "
            f"ABN {_val(c, 'abn') or 'none on file'}"
        ]
        for loc in locs_by_co.get(cid, [])[:4]:
            place = " ".join(p for p in (_val(loc, "suburb"), _val(loc, "postcode")) if p)
            site = _val(loc, "site_name") + (f" ({_val(loc, 'location_type')})" if _val(loc, "location_type") else "")
            detail = ", ".join(p for p in (site, _val(loc, "address"), place) if p)
            if detail:
                lines.append(f"Site: {detail}")
        cts = cts_by_co.get(cid, [])
        if cts:
            lines.append(f"Contacts ({len(cts)}):")
        for ct in cts[:8]:
            head = _val(ct, "name")
            if _val(ct, "position"):
                head += f" -- {_val(ct, 'position')}"
            if _val(ct, "role_priority"):
                head += f" ({_val(ct, 'role_priority').title()})"
            extras = [x for x in (_val(ct, "business_email"), _val(ct, "mobile") or _val(ct, "landline")) if x]
            lines.append("- " + " · ".join([head, *extras]))
        if len(cts) > 8:
            lines.append(f"...and {len(cts) - 8} more contacts")
        if not cts:
            lines.append("No contacts on file for this company.")
        ctx.matches.append("\n".join(lines))
    if len(scored) > 4:
        ctx.matches.append(
            "Other companies that also match the wording: "
            + ", ".join(_val(c, "company_name") for _, c in scored[4:12])
        )

    # --- people named in the question --------------------------------------
    people = 0
    for ct in contacts:
        toks = _tokens(_val(ct, "name"))
        if len(toks) >= 2 and all(t in q_tokens for t in toks):
            co = co_by_id.get(_val(ct, "company_id"), {})
            ctx.matches.append(
                f"**{_val(ct, 'name')}** -- {_val(ct, 'position') or 'no position on file'} at "
                f"{_val(co, 'company_name') or 'an unknown company'}. "
                f"Email: {_val(ct, 'business_email') or 'none'}. Mobile: {_val(ct, 'mobile') or 'none'}."
            )
            people += 1
            if people >= 4:
                break

    # --- postcode questions --------------------------------------------------
    for pc in dict.fromkeys(_POSTCODE.findall(question)).keys():
        in_pc = [l for l in locations if _val(l, "postcode") == pc]
        if not in_pc:
            ctx.matches.append(f"Postcode {pc}: no locations on file.")
            continue
        company_ids = list(dict.fromkeys(_val(l, "company_id") for l in in_pc))
        names = [_val(co_by_id.get(i, {}), "company_name") for i in company_ids]
        names = [n for n in names if n]
        ctx.matches.append(
            f"Postcode {pc}: {len(in_pc)} location{'s' if len(in_pc) != 1 else ''} across "
            f"{len(company_ids)} compan{'ies' if len(company_ids) != 1 else 'y'}.\n"
            f"Companies: {', '.join(names[:15])}" + (" ..." if len(names) > 15 else "")
        )

    # --- role questions --------------------------------------------------
    for phrase in _ROLE_PHRASES:
        if phrase in q_lower:
            hits = [c for c in contacts if phrase in _val(c, "position").lower()]
            examples = ", ".join(
                f"{_val(c, 'name')} ({_val(co_by_id.get(_val(c, 'company_id'), {}), 'company_name')})"
                for c in hits[:5]
            )
            ctx.matches.append(
                f"{len(hits)} contact{'s' if len(hits) != 1 else ''} with '{phrase}' in their position."
                + (f"\nExamples: {examples}" if examples else "")
            )
            break

    return ctx


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

_RULES = """\
You are the GenLead assistant for a Queensland industrial prospecting dashboard. \
You help the client's team use the app and understand their own data.

How to answer:
- Answer ONLY from the APP KNOWLEDGE and LIVE DATA below. If it isn't covered, say you don't know and suggest checking \
the Google Sheet or asking the Friction team -- never invent features, numbers, people or steps.
- Quote numbers and names from LIVE DATA exactly. If a specific record isn't in RELEVANT TO THIS QUESTION, say you \
can't find it and suggest the Companies search box.
- For "how do I ..." questions give short numbered steps in plain language. Then add the guide's link marker on its own \
line, and up to 2 of that guide's screenshot markers, each on its own line right after the step it illustrates or at the end. \
Copy markers exactly as written in the guide (e.g. [[open:/companies|Open Companies]], [[shot:approve-reject]]). \
Only use markers that appear in the guides. Never mention the markers or explain them.
- Be honest about KNOWN LIMITATIONS -- in particular, the automated postcode research uses sample data.
- You cannot click buttons or change data; you explain and point to the right page.
- Keep it short and friendly. Australian English. Dates DD/MM/YYYY. No headings; no tables.
"""


def system_prompt(ctx: DataContext) -> str:
    return f"{_RULES}\nAPP KNOWLEDGE\n{render_for_prompt()}\n\n{ctx.render()}"


# ---------------------------------------------------------------------------
# Marker validation
# ---------------------------------------------------------------------------

_OPEN = re.compile(r"\[\[open:([^|\]]+)\|([^\]]+)\]\]")
_SHOT = re.compile(r"\[\[shot:([a-z0-9-]+)\]\]")


def sanitize(text: str) -> str:
    """Drop markers the model invented (unknown path / screenshot) and cap shots."""

    def _open(m: re.Match) -> str:
        return m.group(0) if m.group(1).strip() in KNOWN_PATHS else ""

    seen = 0

    def _shot(m: re.Match) -> str:
        nonlocal seen
        if m.group(1) not in KNOWN_SHOTS or seen >= MAX_SHOTS_PER_ANSWER:
            return ""
        seen += 1
        return m.group(0)

    text = _OPEN.sub(_open, text)
    text = _SHOT.sub(_shot, text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# ---------------------------------------------------------------------------
# Fallback (no AI)
# ---------------------------------------------------------------------------

_GENERIC_KEYWORDS = frozenset({
    "company", "companies", "page", "new", "help", "start", "find", "search", "edit", "update", "fix",
    "site", "sites", "where", "status", "code", "postcode", "person", "people", "role", "position", "email", "phone",
})
_HOWTO = re.compile(r"\b(how (do|can|to|would)|how'?s|guide|steps?|tutorial|show me|walk me|where (do|can)|explain|teach)\b")


def _keyword_score(q: str, kw: str) -> int:
    if " " in kw:
        return 3 if kw in q else 0
    if not re.search(rf"\b{re.escape(kw)}\b", q):
        return 0
    return 1 if kw in _GENERIC_KEYWORDS else 2


def _best_guide(question: str):
    q = question.lower()
    best, best_score = None, 0
    for g in GUIDES:
        score = sum(_keyword_score(q, kw) for kw in g.keywords)
        if score > best_score:
            best, best_score = g, score
    return best if best_score >= 1 else None


def fallback_answer(question: str, ctx: DataContext, ai_down: bool = True) -> str:
    parts: list[str] = []
    if ctx.matches:
        parts.append("Here's what I found in your data:\n\n" + "\n\n".join(ctx.matches))

    guide = _best_guide(question)
    wants_howto = bool(_HOWTO.search(question.lower()))
    if guide and (not ctx.matches or wants_howto):
        block = [f"{guide.title}", guide.summary, ""]
        block += [f"{i}. {s}" for i, s in enumerate(guide.steps, 1)]
        block += [f"Note: {n}" for n in guide.notes]
        if guide.open:
            block.append(f"[[open:{guide.open[0]}|{guide.open[1]}]]")
        block += [f"[[shot:{s}]]" for s in guide.shots[:MAX_SHOTS_PER_ANSWER]]
        parts.append("\n".join(block))

    if not parts:
        parts.append(
            "I can help with:\n"
            "- How to find a company, approve or reject, browse locations and contacts\n"
            "- What the statuses mean and how the Google Sheet stays in sync\n"
            "- Facts from your data, e.g. \"How many companies are in postcode 4744?\" or \"Who is the contact at MetRes?\"\n\n"
            "Try asking one of those."
        )
    if ai_down:
        parts.append("(The AI writing service is unavailable right now, so this answer comes from the built-in guide and your data.)")
    return sanitize("\n\n".join(parts))
