"""Public ABN Lookup site scraper and Australian ABN checksum validation.

The ABN Lookup web-services API requires a registered GUID. This adapter
instead submits the site's ordinary public advanced-search form for a
postcode and a small set of user-selected business-name terms. It honors the
site's robots.txt policy and the crawler's per-domain request limit. ABR name
search is not an industry classification and does not provide websites or
contact people; callers must retain that distinction in the UI and evidence.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

from pydantic import BaseModel

from app.services.crawler import WebsiteCrawler

logger = logging.getLogger(__name__)

ABR_ADVANCED_SEARCH_URL = "https://abr.business.gov.au/Search/Advanced"
ABR_ORIGIN = "https://abr.business.gov.au"
ABR_ATTRIBUTION = "Source: Australian Business Register (ABR)"

# One user search fans out to a bounded set of narrow ABR name queries. These
# terms come from the product's target sectors; they are search terms, not
# claims about an entity's official industry classification.
INDUSTRY_SEARCH_TERMS: dict[str, list[str]] = {
    "mining": ["mining", "quarry", "mineral", "drilling"],
    "energy": ["energy", "power", "generation", "renewable"],
    "heavy industry": ["industrial", "manufacturing", "engineering", "fabrication"],
    "construction": ["construction", "civil", "contracting"],
    "transport": ["transport", "logistics", "freight", "haulage"],
    "manufacturing": ["manufacturing", "fabrication", "engineering", "industrial"],
}
DEFAULT_SEARCH_TERMS = [
    "mining", "quarry", "energy", "manufacturing", "construction", "transport"
]

ABN_WEIGHTS: tuple[int, ...] = (10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19)


class ABREntity(BaseModel):
    """One business record returned by the public ABR search page."""

    abn: str
    name: str
    entity_type: str = ""
    name_type: str = ""
    status: str
    state: str
    postcode: str
    business_names: list[str] = []
    registered_date: date | None = None
    source_url: str = ""


class ABRSearchResult(BaseModel):
    query: str
    total_results: int
    entities: list[ABREntity]


class _ResultTableParser(HTMLParser):
    """Read ABR search-result table rows without retaining page markup."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[dict[str, object]] = []
        self.visible_parts: list[str] = []
        self._row: dict[str, object] | None = None
        self._cell: list[str] | None = None
        self._anchor_href: str | None = None
        self._anchor_text: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "tr":
            self._row = {"cells": [], "links": []}
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []
        elif tag == "a" and self._row is not None:
            self._anchor_href = dict(attrs).get("href")
            self._anchor_text = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript"}:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag == "a" and self._row is not None and self._anchor_href:
            self._row["links"].append(
                (self._anchor_href, " ".join(" ".join(self._anchor_text).split()))
            )
            self._anchor_href = None
            self._anchor_text = []
        elif tag in {"td", "th"} and self._row is not None and self._cell is not None:
            self._row["cells"].append(" ".join(" ".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            cells = self._row.get("cells", [])
            if isinstance(cells, list) and cells:
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if data.strip():
            self.visible_parts.append(data.strip())
        if self._cell is not None:
            self._cell.append(data)
        if self._anchor_href:
            self._anchor_text.append(data)

    @property
    def visible_text(self) -> str:
        return " ".join(self.visible_parts)


def validate_abn(abn: str) -> bool:
    """Validate an Australian Business Number using the official checksum."""
    digits = "".join(char for char in abn if char.isdigit())
    if len(digits) != 11:
        return False
    values = [int(digit) for digit in digits]
    values[0] -= 1
    return sum(digit * weight for digit, weight in zip(values, ABN_WEIGHTS)) % 89 == 0


@dataclass
class ABRAdapter:
    """Search ABR's public HTML interface and validate returned ABNs."""

    api_guid: str | None = None  # retained for compatibility; never required here
    crawler: WebsiteCrawler = field(default_factory=WebsiteCrawler)
    last_warnings: list[str] = field(default_factory=list)
    _entity_cache: dict[str, ABREntity] = field(default_factory=dict)

    @property
    def is_configured(self) -> bool:
        """Public ABR HTML search is available without a registered API GUID."""
        return True

    @staticmethod
    def _query_terms(industry: str | None) -> list[str]:
        if not industry or not industry.strip():
            return DEFAULT_SEARCH_TERMS.copy()
        normalized = " ".join(industry.casefold().split())
        for category, terms in INDUSTRY_SEARCH_TERMS.items():
            if normalized == category or category in normalized:
                return terms.copy()
        return [industry.strip()]

    async def search_by_postcode(
        self,
        postcode: str,
        industry: str | None = None,
    ) -> list[dict]:
        """Scrape active ABR name matches for a QLD postcode.

        Results are partial by design: the public name search returns matches
        to terms, not every business at a postcode. Its result pages do not
        supply industry codes, websites, or contact people.
        """
        if not re.fullmatch(r"4\d{3}", postcode):
            raise ValueError("ABR postcode search supports four-digit QLD postcodes only.")

        self.last_warnings = []
        terms = self._query_terms(industry)[:8]
        merged: dict[str, dict] = {}
        completed_queries = 0

        for term in terms:
            try:
                results, truncated = await self._search_term(postcode, term)
                completed_queries += 1
                if truncated:
                    self.last_warnings.append(
                        f"ABR stopped before all matches in the '{term}' name search were returned."
                    )
                for entity in results:
                    current = merged.get(entity.abn)
                    if current is None:
                        current = entity.model_dump(mode="json")
                        current["matched_terms"] = [term]
                        merged[entity.abn] = current
                        self._entity_cache[entity.abn] = entity
                    else:
                        current["matched_terms"].append(term)
                        for business_name in entity.business_names:
                            if business_name not in current["business_names"]:
                                current["business_names"].append(business_name)
            except Exception as exc:
                logger.warning("ABR public search failed for one term (%s): %s", term, exc)
                self.last_warnings.append(f"ABR search for '{term}' failed: {exc}")

        if not completed_queries:
            raise RuntimeError("All ABR public search queries failed.")

        if self.last_warnings:
            self.last_warnings.append(
                "ABR name matches are not an industry classification and do not include "
                "company websites or contact people."
            )
        return list(merged.values())

    async def _search_term(self, postcode: str, term: str) -> tuple[list[ABREntity], bool]:
        if not await self.crawler.can_fetch(ABR_ADVANCED_SEARCH_URL):
            raise RuntimeError("ABR robots.txt does not allow the search page to be crawled.")

        form_data = {
            "AdvancedSearch": "True",
            "SearchParameters.SearchText": term,
            "SearchParameters.AllNames": "true",
            "SearchParameters.EntityName": "true",
            "SearchParameters.BusinessName": "true",
            "SearchParameters.TradingName": "true",
            "LocationOptionsGroup": "PostcodeRadioButton",
            "SearchParameters.QLD": "true",
            "SearchParameters.Postcode": postcode,
            "SearchParameters.PostcodeDisplay": postcode,
            "SubmitButton": "Search",
        }
        page = await self.crawler.fetch(
            ABR_ADVANCED_SEARCH_URL,
            method="POST",
            form_data=form_data,
        )
        if page.status_code in {403, 429}:
            raise RuntimeError(
                f"ABR returned HTTP {page.status_code}; automated search stopped without retry."
            )
        if page.status_code < 200 or page.status_code >= 300:
            raise RuntimeError(f"ABR returned HTTP {page.status_code}.")

        parser = _ResultTableParser()
        parser.feed(page.body)
        if "verify you are human" in parser.visible_text.casefold() or "captcha" in parser.visible_text.casefold():
            raise RuntimeError("ABR presented an anti-bot challenge; it was not bypassed.")
        truncated = "search was stopped before all matching names" in parser.visible_text.casefold()

        entities: list[ABREntity] = []
        for row in parser.rows:
            cells = row.get("cells", [])
            if not isinstance(cells, list) or len(cells) < 4:
                continue
            first_cell = str(cells[0])
            raw_abn = re.search(r"(?<!\d)(?:\d[\s-]*){11}(?!\d)", first_cell)
            if not raw_abn:
                continue
            abn = "".join(char for char in raw_abn.group(0) if char.isdigit())
            if not validate_abn(abn):
                continue

            name = str(cells[1]).strip()
            if not name:
                continue
            name_type = str(cells[2]).strip()
            result_location = str(cells[3]).strip()
            if result_location and not re.search(
                rf"(?<!\d){re.escape(postcode)}(?!\d)", result_location
            ):
                continue

            status_match = re.search(r"\b(Active|Cancelled)\b", first_cell, re.IGNORECASE)
            status = status_match.group(1).title() if status_match else "Unknown"
            detail_url = ""
            links = row.get("links", [])
            if isinstance(links, list):
                for href, _label in links:
                    parsed_href = urlparse(str(href))
                    if parsed_href.path.casefold().rstrip("/") == "/abn/view":
                        detail_url = urljoin(ABR_ORIGIN, str(href))
                        break
            if not detail_url:
                detail_url = f"{ABR_ORIGIN}/ABN/View?abn={abn}"

            business_names = [name] if "business name" in name_type.casefold() or "trading name" in name_type.casefold() else []
            entity = ABREntity(
                abn=abn,
                name=name,
                status=status,
                state="QLD",
                postcode=postcode,
                business_names=business_names,
                name_type=name_type,
                source_url=detail_url,
            )
            entities.append(entity)

        if not entities:
            visible_text = parser.visible_text.casefold()
            known_empty_result = any(
                marker in visible_text
                for marker in (
                    "no results",
                    "no records",
                    "no matching records",
                    "no matches",
                    "0 records",
                    "zero records",
                )
            )
            if not known_empty_result:
                raise RuntimeError(
                    "ABR response contained neither parseable ABN rows nor a recognized "
                    "no-results message."
                )

        return entities, truncated

    async def lookup_abn(self, abn: str) -> ABREntity | None:
        """Return a search-verified cached ABN; otherwise make no claim."""
        digits = "".join(char for char in abn if char.isdigit())
        if not validate_abn(digits):
            logger.warning("ABN checksum validation failed.")
            return None
        if digits in self._entity_cache:
            return self._entity_cache[digits]

        # Public ABN detail pages are a verification surface, but their
        # structure is not yet part of the supported search contract. Do not
        # infer a result from checksum validity alone.
        if not await self.crawler.can_fetch(f"{ABR_ORIGIN}/ABN/View?abn={digits}"):
            raise RuntimeError("ABR robots.txt does not allow the detail page to be crawled.")
        page = await self.crawler.fetch(f"{ABR_ORIGIN}/ABN/View?abn={digits}")
        if page.status_code == 404:
            return None
        if page.status_code < 200 or page.status_code >= 300:
            raise RuntimeError(f"ABR detail page returned HTTP {page.status_code}.")

        parser = _ResultTableParser()
        parser.feed(page.body)
        fields: dict[str, str] = {}
        for row in parser.rows:
            cells = row.get("cells", [])
            if not isinstance(cells, list) or len(cells) < 2:
                continue
            label = re.sub(r"[^a-z]", "", str(cells[0]).casefold())
            value = str(cells[1]).strip()
            if label:
                fields[label] = value

        name = fields.get("entityname", "").strip()
        status_value = fields.get("abnstatus", "")
        status_match = re.search(r"\b(Active|Cancelled)\b", status_value, re.IGNORECASE)
        if not name or not status_match:
            if "no records found" in parser.visible_text.casefold():
                return None
            raise RuntimeError("ABR detail page was missing a verifiable name or status.")

        location = fields.get("mainbusinesslocation", "")
        state_match = re.search(r"\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b", location, re.IGNORECASE)
        postcode_match = re.search(r"\b(\d{4})\b", location)
        trading_name_value = fields.get("tradingname", "")
        business_names = [
            trading_name.strip()
            for trading_name in re.split(r"[\r\n;|]+", trading_name_value)
            if trading_name.strip()
            and trading_name.strip().casefold() not in {"none", "not applicable"}
        ]
        date_match = re.search(r"\bfrom\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})", status_value)
        registered_date = None
        if date_match:
            try:
                registered_date = datetime.strptime(
                    date_match.group(1), "%d %b %Y"
                ).date()
            except ValueError:
                pass

        entity = ABREntity(
            abn=digits,
            name=name,
            entity_type=fields.get("entitytype", ""),
            status=status_match.group(1).title(),
            state=state_match.group(1).upper() if state_match else "",
            postcode=postcode_match.group(1) if postcode_match else "",
            business_names=business_names,
            registered_date=registered_date,
            source_url=page.url,
        )
        self._entity_cache[digits] = entity
        return entity

    async def search_name(self, name: str) -> ABRSearchResult:
        """Name search remains postcode-scoped in this product workflow."""
        raise RuntimeError(
            "Use search_by_postcode(postcode, industry) to query the public ABR form."
        )
