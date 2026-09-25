"""Jev -- the operations engine for Friction GenLead.

Jev orchestrates the entire research pipeline:
1. Discovery: postcode -> find companies via ABR, web search
2. Verification: check ABN status, verify operating sites
3. Contact Research: find decision-makers via website crawl
4. Evaluation: score industry fit and prioritize

Each step produces evidence that feeds the next. Failures at any
step route to manual review -- Jev never fails silently.
"""

import asyncio
import json
import logging
import math
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum

from app.services.abr import ABRAdapter
from app.services.crawler import WebsiteCrawler, SSRFError, CrawlLimitError
from app.services.firecrawl_search import FirecrawlSearchDiscovery
from app.services.geo import postcode_centroid
from app.services.overture_discovery import OverturePlacesDiscovery
from app.services.resolver import EntityResolver, normalize_company_name
from app.services.sheets import GoogleSheetsAdapter

logger = logging.getLogger(__name__)


class StepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    NEEDS_REVIEW = "needs_review"


@dataclass
class PipelineStep:
    name: str
    status: StepStatus = StepStatus.PENDING
    started_at: datetime | None = None
    completed_at: datetime | None = None
    result: dict | None = None
    error: str | None = None


@dataclass
class ResearchJob:
    job_id: str
    postcode: str
    industry: str | None
    target_roles: list[str]
    location_query: str = ""
    country: str = ""
    country_code: str = ""
    latitude: float | None = None
    longitude: float | None = None
    status: str = "running"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    steps: list[PipelineStep] = field(default_factory=list)
    companies_found: list[dict] = field(default_factory=list)
    contacts_found: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    historical_companies_count: int | None = None
    historical_contacts_count: int | None = None
    result_company_ids: list[str] = field(default_factory=list)
    result_contact_ids: list[str] = field(default_factory=list)
    details_available: bool = True
    details_saved: bool = False
    result_rows_synced: bool = True

    @property
    def companies_count(self) -> int:
        return self.historical_companies_count if self.historical_companies_count is not None else len(self.companies_found)

    @property
    def contacts_count(self) -> int:
        return self.historical_contacts_count if self.historical_contacts_count is not None else len(self.contacts_found)


# In-memory job store (production would use Redis or similar)
_jobs: dict[str, ResearchJob] = {}


class Jev:
    """Jev operations engine.

    Orchestrates the research pipeline with these principles:
    - Every step produces evidence with source and reliability
    - Failures route to manual review, never fail open
    - ABN != operating site (verified separately)
    - Human approval is always required before finalizing
    - Rate limits and SSRF protection are enforced
    """

    def __init__(
        self,
        sheets: GoogleSheetsAdapter | None = None,
        abr: ABRAdapter | None = None,
        crawler: WebsiteCrawler | None = None,
        places: OverturePlacesDiscovery | None = None,
        web_search: FirecrawlSearchDiscovery | None = None,
    ):
        self.abr = abr or ABRAdapter()
        self.crawler = crawler or WebsiteCrawler()
        self.places = places
        self.web_search = web_search
        self.resolver = EntityResolver()
        self.sheets = sheets

    async def start_research(
        self,
        location: str,
        industry: str | None = None,
        target_roles: list[str] | None = None,
    ) -> ResearchJob:
        """Start a new research job for a user-entered place.

        Creates a job with 4 pipeline steps and begins execution.
        Returns the job immediately -- poll status via get_job().
        """
        job = ResearchJob(
            job_id=str(uuid.uuid4()),
            postcode=location if re.fullmatch(r"\d{4}", location) else "",
            industry=industry,
            target_roles=target_roles or [],
            location_query=location,
            steps=[
                PipelineStep(name="discover"),
                PipelineStep(name="verify"),
                PipelineStep(name="research_contacts"),
                PipelineStep(name="evaluate"),
            ],
        )
        _jobs[job.job_id] = job

        await self._persist_job(job)

        # Run pipeline in background
        asyncio.create_task(self._run_pipeline(job))
        return job

    async def get_job(self, job_id: str) -> ResearchJob | None:
        current = _jobs.get(job_id)
        if current:
            return current
        if self.sheets:
            rows = await self.sheets.read_search_runs()
            row = next((r for r in rows if str(r.get("job_id")) == job_id), None)
            if row:
                return self._job_from_run_row(row)
        return None

    async def get_job_results(self, job: ResearchJob) -> ResearchJob:
        """Load persisted result rows for a saved run after process restart."""
        if job.job_id in _jobs or not job.details_available or not self.sheets:
            return job

        company_ids = set(job.result_company_ids)
        contact_ids = set(job.result_contact_ids)
        if (
            job.historical_companies_count is not None
            and len(company_ids) != job.historical_companies_count
        ) or (
            job.historical_contacts_count is not None
            and len(contact_ids) != job.historical_contacts_count
        ):
            raise RuntimeError("Saved research result IDs do not match the persisted summary counts.")
        companies = await self.sheets.read_companies()
        contacts = await self.sheets.read_contacts()
        job.companies_found = [
            row for row in companies if str(row.get("company_id", "")) in company_ids
        ]
        job.contacts_found = [
            row for row in contacts if str(row.get("contact_id", "")) in contact_ids
        ]

        if len(job.companies_found) != len(company_ids) or len(job.contacts_found) != len(contact_ids):
            raise RuntimeError("Saved research results are incomplete in the canonical Sheets tabs.")
        return job

    async def list_jobs(self) -> list[ResearchJob]:
        persisted: dict[str, ResearchJob] = {}
        if self.sheets:
            try:
                for row in await self.sheets.read_search_runs():
                    job = self._job_from_run_row(row)
                    if job.job_id:
                        if job.status == "running" and job.job_id not in _jobs:
                            job.status = "interrupted"
                        persisted[job.job_id] = job
            except Exception:
                logger.exception("Unable to load persisted research history")
        persisted.update(_jobs)
        return sorted(persisted.values(), key=lambda j: j.created_at, reverse=True)

    async def cancel_job(self, job_id: str) -> bool:
        job = _jobs.get(job_id)
        if job and job.status == "running":
            job.status = "cancelled"
            await self._persist_job(job)
            return True
        return False

    @staticmethod
    def _job_from_run_row(row: dict) -> ResearchJob:
        try:
            created_at = datetime.fromisoformat(str(row.get("created_at", "")))
        except ValueError:
            created_at = datetime.now(timezone.utc)
        try:
            updated_at = datetime.fromisoformat(str(row.get("updated_at", "")))
        except ValueError:
            updated_at = created_at
        roles_value = row.get("roles", "[]")
        try:
            roles = json.loads(roles_value) if isinstance(roles_value, str) else roles_value
        except (json.JSONDecodeError, TypeError):
            roles = []
        company_ids = _json_string_list(row.get("company_ids"))
        contact_ids = _json_string_list(row.get("contact_ids"))
        details_saved = str(row.get("details_saved", "")).strip().casefold() == "true"
        job = ResearchJob(
            job_id=str(row.get("job_id", "")),
            postcode=str(row.get("postcode", "")),
            industry=row.get("industry") or None,
            target_roles=roles if isinstance(roles, list) else [],
            location_query=str(row.get("location_query") or row.get("postcode") or ""),
            country=str(row.get("country") or ""),
            country_code=str(row.get("country_code") or ""),
            latitude=_safe_float(row.get("latitude")),
            longitude=_safe_float(row.get("longitude")),
            status=str(row.get("status", "failed")),
            created_at=created_at,
            updated_at=updated_at,
            result_company_ids=company_ids,
            result_contact_ids=contact_ids,
            # Older summaries may have a stale false flag even though the exact
            # canonical row IDs were saved. Let get_job_results verify those IDs
            # against Companies/Contacts; it still fails closed if any are absent.
            details_available=details_saved or bool(company_ids or contact_ids),
            details_saved=details_saved,
        )
        job.historical_companies_count = _safe_int(row.get("companies_found"))
        job.historical_contacts_count = _safe_int(row.get("contacts_found"))
        error_summary = str(row.get("error_summary", "")).strip()
        if error_summary:
            job.errors.append(error_summary)
        job.warnings = _json_string_list(row.get("warnings"))
        return job

    async def _persist_job(self, job: ResearchJob) -> None:
        """Write only the durable run summary; result rows remain in canonical tabs."""
        if not self.sheets:
            return
        job.updated_at = datetime.now(timezone.utc)
        try:
            job.details_saved = self.sheets.is_live and job.result_rows_synced
        except Exception:
            job.details_saved = False
        result = await self.sheets.upsert_search_run({
            "job_id": job.job_id,
            "postcode": job.postcode,
            "location_query": job.location_query or job.postcode,
            "country": job.country,
            "country_code": job.country_code,
            "latitude": job.latitude if job.latitude is not None else "",
            "longitude": job.longitude if job.longitude is not None else "",
            "industry": job.industry or "",
            "roles": json.dumps(job.target_roles),
            "status": job.status,
            "companies_found": len(job.companies_found),
            "contacts_found": len(job.contacts_found),
            "created_at": job.created_at.isoformat(),
            "updated_at": job.updated_at.isoformat(),
            "error_summary": "; ".join(job.errors)[:1000],
            "company_ids": json.dumps(
                job.result_company_ids
                or [str(company.get("company_id", "")) for company in job.companies_found if company.get("company_id")]
            ),
            "contact_ids": json.dumps(
                job.result_contact_ids
                or [str(contact.get("contact_id", "")) for contact in job.contacts_found if contact.get("contact_id")]
            ),
            "warnings": json.dumps(job.warnings, ensure_ascii=False),
            "details_saved": "true" if job.details_saved else "false",
        })
        if result.value != "SYNCED":
            logger.warning("Research history for %s could not be persisted", job.job_id)

    async def _run_pipeline(self, job: ResearchJob) -> None:
        """Execute the full research pipeline."""
        try:
            await self._step_discover(job)
            if job.status == "cancelled":
                return
            if job.steps[0].status != StepStatus.COMPLETED:
                job.status = "failed"
                job.errors.append(
                    "Company discovery did not complete; subsequent research steps were skipped."
                )
                await self._persist_job(job)
                return
            await self._persist_job(job)

            await self._step_verify(job)
            await self._persist_job(job)
            if job.status == "cancelled":
                return

            await self._step_research_contacts(job)
            await self._persist_job(job)
            if job.status == "cancelled":
                return

            await self._step_evaluate(job)

            job.status = "completed"
            await self._persist_job(job)
        except Exception as e:
            job.status = "failed"
            job.errors.append(f"Pipeline error: {str(e)}")
            await self._persist_job(job)

    async def _step_discover(self, job: ResearchJob) -> None:
        """Step 1: Discover companies in the postcode area."""
        if self.places is not None:
            await self._step_discover_public_sources(job)
            return

        step = job.steps[0]
        step.status = StepStatus.RUNNING
        step.started_at = datetime.now(timezone.utc)

        try:
            results = await self.abr.search_by_postcode(job.postcode, job.industry)
            job.warnings.extend(self.abr.last_warnings)

            existing_rows: list[dict] = []
            rejected_rows: list[dict] = []
            if self.sheets:
                # Dedupe must be based on the canonical live tabs. If their
                # reads fail, the outer handler marks discovery for review and
                # no un-deduped candidates are written.
                existing_rows = await self.sheets.read_companies()
                rejected_rows = await self.sheets.read_rejected()
                read_error = getattr(self.sheets, "tab_read_error", None)
                if callable(read_error):
                    failed_tabs = [
                        tab for tab in ("companies", "rejected")
                        if read_error(tab)
                    ]
                    if failed_tabs:
                        raise RuntimeError(
                            "Could not safely deduplicate prospects because the live "
                            f"Google Sheet tab read failed: {', '.join(failed_tabs)}."
                        )

            existing_abns: set[str] = set()
            existing_names: set[str] = set()
            for row in existing_rows:
                abn = _digits(row.get("abn"))
                if abn:
                    existing_abns.add(abn)
                name = str(row.get("company_name") or row.get("normalized_name") or "")
                normalized = normalize_company_name(name)
                if normalized:
                    existing_names.add(normalized)

            rejected_abns: set[str] = set()
            rejected_names: set[str] = set()
            for row in rejected_rows:
                if str(row.get("entity_type", "")).casefold() != "company":
                    continue
                name = normalize_company_name(str(row.get("entity_name", "")))
                if name:
                    rejected_names.add(name)
                original = row.get("original_data", "")
                if isinstance(original, str):
                    try:
                        original = json.loads(original)
                    except json.JSONDecodeError:
                        original = {}
                if isinstance(original, dict):
                    rejected_abn = _digits(original.get("abn"))
                    if rejected_abn:
                        rejected_abns.add(rejected_abn)

            discovered: list[dict] = []
            seen_abns: set[str] = set()
            seen_names: set[str] = set()
            for raw in results:
                candidate = dict(raw)
                abn = _digits(candidate.get("abn"))
                name = str(candidate.get("name", "")).strip()
                normalized = normalize_company_name(name)
                status = str(candidate.get("status", "Unknown"))
                if not abn or not name or abn in seen_abns:
                    continue
                if status.casefold() == "cancelled":
                    job.warnings.append(
                        f"Skipped cancelled ABN record {abn}; inactive entities are not added as prospects."
                    )
                    continue
                if abn in existing_abns or abn in rejected_abns:
                    continue
                if normalized and (
                    normalized in rejected_names
                    or normalized in existing_names
                    or normalized in seen_names
                ):
                    # An exact-name collision with a different ABN is kept
                    # only if ABR confirms the names differ as organizations;
                    # otherwise it is a duplicate-risk item for manual review.
                    same_name_row = next(
                        (
                            row for row in existing_rows
                            if normalize_company_name(
                                str(row.get("company_name") or row.get("normalized_name") or "")
                            ) == normalized
                        ),
                        None,
                    )
                    existing_name_abn = _digits(same_name_row.get("abn")) if same_name_row else ""
                    if normalized in rejected_names or not existing_name_abn or existing_name_abn == abn:
                        continue
                    candidate["source_quality_flags"] = "POSSIBLE_NAME_COLLISION; REVIEW_BEFORE_APPROVAL"
                    job.warnings.append(
                        f"ABN {abn} shares an exact normalized name with a different ABN in the Sheet; kept for review."
                    )

                now = datetime.now(timezone.utc).isoformat()
                company_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"frictiongenlead:abr:{abn}"))
                matched_terms = candidate.get("matched_terms", [])
                candidate.update({
                    "company_id": company_id,
                    "company_name": name,
                    "normalized_name": normalized,
                    "website": str(candidate.get("website") or ""),
                    "trading_name": next(
                        (
                            str(business_name).strip()
                            for business_name in candidate.get("business_names", [])
                            if str(business_name).strip()
                            and normalize_company_name(str(business_name)) != normalized
                        ),
                        "",
                    ),
                    # ABR public name search does not expose an industry code.
                    "industry": "",
                    "abn_status": status,
                    "status": "NEW" if status.casefold() == "active" else "REVIEW",
                    "industry_fit": "",
                    "source": "ABR",
                    "last_verified": now if status.casefold() == "active" else "",
                    "last_modified": now,
                    "source_verification": (
                        "ABR public name match. Active status is from ABN Lookup; "
                        "industry, operating site, and website are not verified."
                    ),
                    "source_provenance": json.dumps({
                        "provider": "ABN Lookup public advanced search",
                        "record_url": candidate.get("source_url", ""),
                        "postcode": job.postcode,
                        "state": "QLD",
                        "matched_terms": matched_terms,
                        "name_type": candidate.get("name_type", ""),
                        "retrieved_at": now,
                        "attribution": "Source: Australian Business Register (ABR)",
                    }, ensure_ascii=False),
                })
                if not candidate.get("source_quality_flags"):
                    candidate["source_quality_flags"] = (
                        "ABR_NAME_MATCH_ONLY; INDUSTRY_UNVERIFIED; WEBSITE_UNRESOLVED; "
                        "OPERATING_SITE_UNVERIFIED"
                    )
                if normalized:
                    seen_names.add(normalized)
                seen_abns.add(abn)
                discovered.append(candidate)

            job.companies_found = discovered
            job.result_company_ids = [company["company_id"] for company in discovered]

            if self.sheets:
                for company in discovered:
                    sync = await self.sheets.upsert_company(company)
                    if sync.value != "SYNCED":
                        job.result_rows_synced = False
                        job.warnings.append(
                            f"Company {company['company_name']} was found but its Companies-tab write is pending."
                        )

                    location_id = str(uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"frictiongenlead:abr-location:{company['abn']}:{job.postcode}",
                    ))
                    location = {
                        "location_id": location_id,
                        "company_id": company["company_id"],
                        "site_name": "ABR main business location (postcode only)",
                        "location_type": "OTHER",
                        "state": "QLD",
                        "postcode": job.postcode,
                        "raw_postcode": job.postcode,
                        "verification_status": "UNVERIFIED",
                        "source_provenance": json.dumps({
                            "provider": "ABN Lookup public advanced search",
                            "record_url": company.get("source_url", ""),
                            "note": "Registered/main postcode only; not evidence of an operating site.",
                        }, ensure_ascii=False),
                        "source_quality_flags": "POSTCODE_ONLY; OPERATING_SITE_UNVERIFIED",
                        "last_modified": datetime.now(timezone.utc).isoformat(),
                    }
                    location_sync = await self.sheets.upsert_location(location)
                    if location_sync.value != "SYNCED":
                        job.warnings.append(
                            f"Postcode evidence for {company['company_name']} was not synced to Locations."
                        )

                if not self.sheets.is_live:
                    job.result_rows_synced = False
                    job.warnings.append(
                        "Google Sheets is in mock mode; these research candidates are not durable across restarts."
                    )

            if not any(company.get("website") for company in discovered):
                job.warnings.append(
                    "ABR returned company-name and postcode evidence only; no websites were supplied, "
                    "so contact-page crawling cannot run for these new records yet."
                )

            step.result = {
                "company_name_matches": len(job.companies_found),
                "already_known_or_rejected_skipped": max(0, len(results) - len(job.companies_found)),
                "industry_verified": 0,
                "website_available": sum(bool(company.get("website")) for company in discovered),
            }
            step.status = StepStatus.COMPLETED
            step.completed_at = datetime.now(timezone.utc)

        except Exception as e:
            step.status = StepStatus.NEEDS_REVIEW
            step.error = str(e)
            job.warnings.append(f"Discovery had issues: {e}. Manual review needed.")

    async def _step_discover_public_sources(self, job: ResearchJob) -> None:
        """Discover mapped businesses globally, with ABR added for QLD postcodes."""
        step = job.steps[0]
        step.status = StepStatus.RUNNING
        step.started_at = datetime.now(timezone.utc)
        location_query = job.location_query or job.postcode

        try:
            raw_results: list[dict] = []
            web_results: list[dict] = []
            source_errors: list[str] = []
            successful_sources = 0

            if re.fullmatch(r"4\d{3}", location_query):
                try:
                    abr_results = await self.abr.search_by_postcode(location_query, job.industry)
                    for candidate in abr_results:
                        candidate = dict(candidate)
                        candidate.setdefault("source", "ABR")
                        raw_results.append(candidate)
                    job.warnings.extend(getattr(self.abr, "last_warnings", []))
                    successful_sources += 1
                except Exception as exc:
                    source_errors.append(f"ABR postcode search failed: {exc}")

            if self.places is not None:
                try:
                    place_results = await self.places.search(location_query, job.industry)
                    raw_results.extend(place_results)
                    job.warnings.extend(getattr(self.places, "last_warnings", []))
                    successful_sources += 1
                except Exception as exc:
                    source_errors.append(f"Global public-place search failed: {exc}")

            if self.web_search is not None:
                try:
                    web_results = await self.web_search.search(location_query, job.industry)
                    job.warnings.extend(getattr(self.web_search, "last_warnings", []))
                    if len(web_results) > 10:
                        job.warnings.append(
                            "Public web results are limited to 10 candidates per run so mapped and registry sources remain represented."
                        )
                    successful_sources += 1
                except Exception as exc:
                    logger.warning("Public web search failed: %s", type(exc).__name__)
                    source_errors.append("Public web search failed; other successful sources were retained.")

            if successful_sources == 0:
                raise RuntimeError("; ".join(source_errors) or "No public discovery source is available.")
            raw_results = _blend_public_source_candidates(raw_results, web_results)
            job.warnings.extend(source_errors)
            if not raw_results and source_errors:
                raise RuntimeError("No public discovery source completed successfully: " + "; ".join(source_errors))

            existing_rows: list[dict] = []
            rejected_rows: list[dict] = []
            if self.sheets:
                existing_rows = await self.sheets.read_companies()
                rejected_rows = await self.sheets.read_rejected()
                read_error = getattr(self.sheets, "tab_read_error", None)
                if callable(read_error):
                    failed_tabs = [tab for tab in ("companies", "rejected") if read_error(tab)]
                    if failed_tabs:
                        raise RuntimeError(
                            "Could not safely deduplicate prospects because the live Google Sheet "
                            f"tab read failed: {', '.join(failed_tabs)}."
                        )

            existing_abns: set[str] = set()
            existing_names: set[str] = set()
            existing_provider_ids: set[str] = set()
            for row in existing_rows:
                abn = _digits(row.get("abn"))
                if abn:
                    existing_abns.add(abn)
                name = normalize_company_name(str(row.get("company_name") or row.get("normalized_name") or ""))
                if name:
                    existing_names.add(name)
                existing_provider_ids.update(_provider_ids_from_provenance(row.get("source_provenance")))

            rejected_abns: set[str] = set()
            rejected_names: set[str] = set()
            rejected_provider_ids: set[str] = set()
            for row in rejected_rows:
                if str(row.get("entity_type", "")).casefold() != "company":
                    continue
                name = normalize_company_name(str(row.get("entity_name", "")))
                if name:
                    rejected_names.add(name)
                original = row.get("original_data", "")
                if isinstance(original, str):
                    try:
                        original = json.loads(original)
                    except json.JSONDecodeError:
                        original = {}
                if isinstance(original, dict):
                    rejected_abn = _digits(original.get("abn"))
                    if rejected_abn:
                        rejected_abns.add(rejected_abn)
                    rejected_provider_id = str(original.get("provider_id") or "").strip()
                    if rejected_provider_id:
                        rejected_provider_ids.add(rejected_provider_id)
                    rejected_provider_ids.update(
                        _provider_ids_from_provenance(original.get("source_provenance"))
                    )

            discovered: list[dict] = []
            seen_abns: set[str] = set()
            seen_names: set[str] = set()
            seen_provider_ids: set[str] = set()
            now = datetime.now(timezone.utc).isoformat()
            for raw in raw_results:
                if len(discovered) >= 30:
                    job.warnings.append("Search was capped at 30 new companies to keep Sheet writes bounded.")
                    break
                candidate = dict(raw)
                source = str(candidate.get("source") or "ABR").upper()
                abn = _digits(candidate.get("abn"))
                name = " ".join(str(candidate.get("name") or candidate.get("company_name") or "").split())
                normalized = normalize_company_name(name)
                provider_id = str(candidate.get("provider_id") or "").strip()
                if not name or (source == "ABR" and not abn):
                    continue
                if source != "ABR" and not provider_id:
                    continue
                if source == "ABR" and str(candidate.get("status", "")).casefold() == "cancelled":
                    continue
                if provider_id in seen_provider_ids or (abn and (abn in existing_abns or abn in rejected_abns or abn in seen_abns)):
                    continue
                if provider_id and (provider_id in existing_provider_ids or provider_id in rejected_provider_ids):
                    continue
                if normalized and (
                    normalized in rejected_names
                    or normalized in existing_names
                    or normalized in seen_names
                ):
                    same_name_row = next(
                        (
                            row for row in existing_rows
                            if normalize_company_name(str(row.get("company_name") or row.get("normalized_name") or "")) == normalized
                        ),
                        None,
                    )
                    existing_name_abn = _digits(same_name_row.get("abn")) if same_name_row else ""
                    if normalized in rejected_names or source != "ABR" or not existing_name_abn or existing_name_abn == abn:
                        continue
                    candidate["source_quality_flags"] = "POSSIBLE_NAME_COLLISION; REVIEW_BEFORE_APPROVAL"
                    job.warnings.append(
                        f"ABN {abn} shares an exact normalized name with a different ABN in the Sheet; kept for review."
                    )

                identity = abn if source == "ABR" else provider_id
                company_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"frictiongenlead:{source.casefold()}:{identity}"))
                candidate.update({
                    "company_id": company_id,
                    "company_name": name,
                    "normalized_name": normalized,
                    "trading_name": str(candidate.get("trading_name") or ""),
                    "website": str(candidate.get("website") or ""),
                    "abn": abn,
                    "industry": str(candidate.get("industry") or ""),
                    "abn_status": str(candidate.get("status") or "Unknown") if source == "ABR" else "",
                    "status": "NEW",
                    "industry_fit": "",
                    "source": source,
                    "country": str(candidate.get("country") or ("Australia" if source == "ABR" else "")),
                    "country_code": str(candidate.get("country_code") or ("au" if source == "ABR" else "")),
                    "last_verified": "",
                    "last_modified": now,
                })
                if source == "ABR":
                    candidate["source_verification"] = (
                        "ABR public name match. Active status is from ABN Lookup; industry, operating site, "
                        "and website are not verified."
                    )
                    candidate["source_provenance"] = json.dumps({
                        "provider": "ABN Lookup public advanced search",
                        "provider_id": abn,
                        "record_url": candidate.get("source_url", ""),
                        "postcode": location_query,
                        "state": "QLD",
                        "matched_terms": candidate.get("matched_terms", []),
                        "name_type": candidate.get("name_type", ""),
                        "retrieved_at": now,
                        "attribution": "Source: Australian Business Register (ABR)",
                    }, ensure_ascii=False)
                    candidate["source_quality_flags"] = candidate.get("source_quality_flags") or (
                        "ABR_NAME_MATCH_ONLY; INDUSTRY_UNVERIFIED; WEBSITE_UNRESOLVED; OPERATING_SITE_UNVERIFIED"
                    )
                elif source == "OVERTURE_MAPS":
                    candidate["business_phone"] = str(candidate.get("phone") or "")
                    candidate["business_email"] = str(candidate.get("email") or "")
                    candidate["source_verification"] = (
                        "Overture Places map candidate. It is not a company-register verification; "
                        "the industry category, current operation, website, and published contact channels need review."
                    )
                    provenance = candidate.get("source_provenance")
                    provenance = dict(provenance) if isinstance(provenance, dict) else {}
                    provenance.update({
                        "provider_id": provider_id,
                        "location_query": location_query,
                        "requested_industry": job.industry or "",
                        "retrieved_at": provenance.get("retrieved_at") or now,
                        "record_url": candidate.get("source_url", ""),
                    })
                    candidate["source_provenance"] = json.dumps(provenance, ensure_ascii=False, default=str)
                    candidate["source_quality_flags"] = candidate.get("source_quality_flags") or (
                        "OVERTURE_MAPS_CANDIDATE; INDUSTRY_CATEGORY_MATCH_NOT_VERIFIED; CONTACT_DETAILS_REQUIRE_REVIEW"
                    )
                elif source == "FIRECRAWL_SEARCH":
                    candidate["business_phone"] = ""
                    candidate["business_email"] = ""
                    candidate["source_verification"] = (
                        "Public web-search result only. Company identity, requested sector fit, website ownership, "
                        "and a current operating site are unverified; review before contacting."
                    )
                    provenance = candidate.get("source_provenance")
                    provenance = dict(provenance) if isinstance(provenance, dict) else {}
                    provenance.update({
                        "provider_id": provider_id,
                        "location_query": location_query,
                        "requested_industry": job.industry or "",
                        "retrieved_at": provenance.get("retrieved_at") or now,
                        "record_url": candidate.get("source_url", ""),
                    })
                    candidate["source_provenance"] = json.dumps(provenance, ensure_ascii=False, default=str)
                    candidate["source_quality_flags"] = candidate.get("source_quality_flags") or (
                        "WEB_SEARCH_CANDIDATE; COMPANY_IDENTITY_UNVERIFIED; INDUSTRY_UNVERIFIED; "
                        "WEBSITE_OWNERSHIP_UNVERIFIED; OPERATING_SITE_UNVERIFIED"
                    )
                else:
                    # Retained for old rows and tests; production discovery now uses Overture.
                    tags = candidate.get("osm_tags") if isinstance(candidate.get("osm_tags"), dict) else {}
                    candidate["business_landlines"] = str(candidate.get("phone") or "")
                    candidate["source_verification"] = (
                        "OpenStreetMap-mapped feature. Company operation, legal status, industry fit, "
                        "website ownership, and contact details are not independently verified."
                    )
                    candidate["source_provenance"] = json.dumps({
                        "provider": "OpenStreetMap",
                        "provider_id": provider_id,
                        "record_url": candidate.get("source_url", ""),
                        "location_query": location_query,
                        "requested_industry": job.industry or "",
                        "retrieved_at": now,
                        "latitude": candidate.get("lat"),
                        "longitude": candidate.get("lng"),
                        "tags": tags,
                        "license": "Open Database License (ODbL)",
                        "attribution": "© OpenStreetMap contributors",
                    }, ensure_ascii=False)
                    candidate["source_quality_flags"] = candidate.get("source_quality_flags") or (
                        "OSM_MAPPED_BUSINESS; INDUSTRY_UNVERIFIED; BUSINESS_STATUS_UNVERIFIED"
                    )
                if normalized:
                    seen_names.add(normalized)
                if abn:
                    seen_abns.add(abn)
                if provider_id:
                    seen_provider_ids.add(provider_id)
                discovered.append(candidate)

            job.companies_found = discovered
            job.result_company_ids = [company["company_id"] for company in discovered]

            if self.sheets:
                for company in discovered:
                    sync = await self.sheets.upsert_company(company)
                    if sync.value != "SYNCED":
                        job.result_rows_synced = False
                        job.warnings.append(f"Company {company['company_name']} was found but its Companies-tab write is pending.")

                    source = str(company.get("source", "")).upper()
                    if source == "FIRECRAWL_SEARCH":
                        # Search-result pages do not contain a verified operating-site location.
                        # Persist the company candidate, but do not manufacture a map row or coordinates.
                        continue
                    if source == "ABR":
                        postcode = str(company.get("postcode") or location_query)
                        centroid = postcode_centroid(postcode)
                        location = {
                            "location_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"frictiongenlead:abr-location:{company['abn']}:{postcode}")),
                            "company_id": company["company_id"],
                            "site_name": "ABR main business location (postcode only)",
                            "location_type": "OTHER",
                            "state": str(company.get("state") or "QLD"),
                            "postcode": postcode,
                            "country": "Australia",
                            "lat": centroid[0] if centroid else "",
                            "lng": centroid[1] if centroid else "",
                            "verification_status": "UNVERIFIED",
                            "source_provenance": json.dumps({
                                "provider": "ABN Lookup public advanced search",
                                "record_url": company.get("source_url", ""),
                                "note": "Registered/main postcode only; not evidence of an operating site.",
                            }, ensure_ascii=False),
                            "source_quality_flags": "POSTCODE_ONLY; OPERATING_SITE_UNVERIFIED",
                            "last_modified": datetime.now(timezone.utc).isoformat(),
                        }
                    else:
                        tags = company.get("osm_tags") if isinstance(company.get("osm_tags"), dict) else {}
                        if source == "OVERTURE_MAPS":
                            location_type = "OTHER"
                        elif tags.get("landuse") == "quarry" or tags.get("man_made") == "mineshaft":
                            location_type = "MINE"
                        elif tags.get("industrial") or tags.get("man_made") == "works":
                            location_type = "PLANT"
                        elif tags.get("office") == "company":
                            location_type = "OFFICE"
                        else:
                            location_type = "OTHER"
                        location = {
                            "location_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"frictiongenlead:{source.casefold()}-location:{company.get('provider_id', '')}")),
                            "company_id": company["company_id"],
                            "site_name": company["company_name"],
                            "location_type": location_type,
                            "address": str(company.get("address") or ""),
                            "suburb": str(company.get("suburb") or ""),
                            "state": str(company.get("state") or ""),
                            "postcode": str(company.get("postcode") or ""),
                            "country": str(company.get("country") or ""),
                            "lat": company.get("lat", ""),
                            "lng": company.get("lng", ""),
                            "verification_status": "UNVERIFIED",
                            "source_provenance": company.get("source_provenance", ""),
                            "source_quality_flags": company.get("source_quality_flags", ""),
                            "last_modified": datetime.now(timezone.utc).isoformat(),
                        }
                    location_sync = await self.sheets.upsert_location(location)
                    if location_sync.value != "SYNCED":
                        job.result_rows_synced = False
                        job.warnings.append(f"Location for {company['company_name']} was not synced.")

                if not self.sheets.is_live:
                    job.result_rows_synced = False
                    job.warnings.append("Google Sheets is in mock mode; these research candidates are not durable across restarts.")

            step.result = {
                "public_source_matches": len(job.companies_found),
                "already_known_or_rejected_skipped": max(0, len(raw_results) - len(job.companies_found)),
                "industry_verified": 0,
                "websites_available": sum(bool(company.get("website")) for company in discovered),
            }
            step.status = StepStatus.COMPLETED
            step.completed_at = datetime.now(timezone.utc)
        except Exception as exc:
            step.status = StepStatus.NEEDS_REVIEW
            step.error = str(exc)
            job.warnings.append(f"Discovery had issues: {exc}. Manual review needed.")

    async def _step_verify(self, job: ResearchJob) -> None:
        """Step 2: Confirm ABN status; do not equate registration with a site."""
        step = job.steps[1]
        step.status = StepStatus.RUNNING
        step.started_at = datetime.now(timezone.utc)

        active_abn_count = 0
        review_count = 0

        for company in job.companies_found:
            abn = company.get("abn", "")
            if not abn:
                company["verification"] = "NEEDS_REVIEW"
                company["verification_note"] = "No ABN found"
                review_count += 1
                continue

            try:
                entity = await self.abr.lookup_abn(abn)
                if entity and entity.status == "Active":
                    company["verification"] = "ABN_ACTIVE"
                    company["abn_status"] = "Active"
                    company["source_verification"] = (
                        f"ABR reports an active ABN. Name type: {entity.name_type or 'detail record'}. "
                        "This does not verify industry or an operating site."
                    )
                    company["last_verified"] = datetime.now(timezone.utc).isoformat()
                    active_abn_count += 1
                elif entity:
                    company["verification"] = "NEEDS_REVIEW"
                    company["verification_note"] = f"ABN status: {entity.status}"
                    company["abn_status"] = entity.status
                    review_count += 1
                else:
                    company["verification"] = "NEEDS_REVIEW"
                    company["verification_note"] = "ABN not found in ABR"
                    review_count += 1
            except Exception as e:
                company["verification"] = "NEEDS_REVIEW"
                company["verification_note"] = f"ABR lookup failed: {e}"
                review_count += 1
                job.warnings.append(f"ABR lookup failed for {abn}: {e}")

            if self.sheets:
                sync = await self.sheets.upsert_company({
                    "company_id": company.get("company_id", ""),
                    "abn": abn,
                    "abn_status": company.get("abn_status", ""),
                    "source_verification": company.get("source_verification", ""),
                    "last_verified": company.get("last_verified", ""),
                    "last_modified": datetime.now(timezone.utc).isoformat(),
                })
                if sync.value != "SYNCED":
                    job.warnings.append(
                        f"ABN verification for {company.get('company_name', 'a company')} was not synced."
                    )

        step.result = {"active_abns": active_abn_count, "needs_review": review_count}
        step.status = StepStatus.COMPLETED
        step.completed_at = datetime.now(timezone.utc)

    async def _step_research_contacts(self, job: ResearchJob) -> None:
        """Step 3: Find contacts via website crawling."""
        step = job.steps[2]
        step.status = StepStatus.RUNNING
        step.started_at = datetime.now(timezone.utc)

        websites = [company for company in job.companies_found if company.get("website")]
        selected = websites[:10]
        skipped = max(0, len(websites) - len(selected))
        if skipped:
            job.warnings.append(
                f"Contact research crawled the first {len(selected)} of {len(websites)} website candidates in this run."
            )
        if not websites:
            job.warnings.append(
                "No verified company website URL was available to crawl; no people or contact details were inferred."
            )

        semaphore = asyncio.Semaphore(3)

        async def crawl_company(company: dict) -> tuple[dict, list, str | None]:
            website = str(company.get("website", ""))
            async with semaphore:
                try:
                    pages = await self.crawler.crawl_site(website, max_pages=4)
                    if not pages:
                        return company, [], f"No crawlable pages were available for {website}."
                    extracted = []
                    for page in pages:
                        if "html" not in page.content_type.casefold():
                            continue
                        extracted.extend(
                            await self.crawler.extract_contacts(page.body, page.url)
                        )
                    return company, extracted, None
                except SSRFError as exc:
                    return company, [], f"SSRF blocked for {website}: {exc}"
                except CrawlLimitError as exc:
                    return company, [], f"Crawl limit for {website}: {exc}"
                except Exception as exc:
                    return company, [], f"Crawl failed for {website}: {exc}"

        crawl_results = await asyncio.gather(*(crawl_company(company) for company in selected))
        seen_contacts: set[tuple[str, str, str, str]] = set()
        for company, extracted, crawl_error in crawl_results:
            if crawl_error:
                job.warnings.append(crawl_error)
                continue

            company_id = str(company.get("company_id", ""))
            named_contacts = [
                contact for contact in extracted
                if contact.name.strip() and contact.role.strip()
            ]
            generic_channels = [
                contact for contact in extracted
                if not contact.name.strip() and (contact.email or contact.phone)
            ]
            if generic_channels:
                phones = sorted({contact.phone for contact in generic_channels if contact.phone})
                emails = sorted({contact.email for contact in generic_channels if contact.email})
                channel_notes = []
                if emails:
                    channel_notes.append("General business emails: " + ", ".join(emails))
                if phones:
                    channel_notes.append("General business phone numbers: " + ", ".join(phones))
                    previous = str(company.get("business_landlines", "")).strip()
                    company["business_landlines"] = "; ".join(dict.fromkeys([previous, *phones])).strip("; ")
                if channel_notes:
                    previous_notes = str(company.get("source_verification", "")).strip()
                    company["source_verification"] = "; ".join(
                        item for item in [previous_notes, *channel_notes] if item
                    )

            for contact in named_contacts:
                role_match = not job.target_roles or any(
                    _role_matches(target, contact.role)
                    for target in job.target_roles
                )
                if not role_match:
                    continue
                normalized_key = (
                    company_id,
                    " ".join(contact.name.casefold().split()),
                    " ".join(contact.role.casefold().split()),
                    contact.email.casefold(),
                )
                if normalized_key in seen_contacts:
                    continue
                seen_contacts.add(normalized_key)
                contact_id = str(uuid.uuid5(
                    uuid.NAMESPACE_URL,
                    "frictiongenlead:contact:" + ":".join(normalized_key),
                ))
                job.contacts_found.append({
                    "contact_id": contact_id,
                    "company_id": company_id,
                    "name": contact.name,
                    "role": contact.role,
                    "email": contact.email,
                    "phone": contact.phone,
                    "company": company.get("company_name", company.get("name", "")),
                    "source_url": contact.source_url,
                    "verification": "UNVERIFIED",
                })

            if self.sheets and generic_channels:
                sync = await self.sheets.upsert_company({
                    "company_id": company_id,
                    "business_landlines": company.get("business_landlines", ""),
                    "source_verification": company.get("source_verification", ""),
                    "last_modified": datetime.now(timezone.utc).isoformat(),
                })
                if sync.value != "SYNCED":
                    job.warnings.append(
                        f"General contact channels for {company.get('company_name', 'a company')} were not synced."
                    )

        for contact in job.contacts_found:
            contact_id = str(contact["contact_id"])
            if contact_id not in job.result_contact_ids:
                job.result_contact_ids.append(contact_id)
            if not self.sheets:
                continue
            name_parts = str(contact["name"]).split()
            phone = str(contact.get("phone", ""))
            is_mobile = re.match(r"^(?:\+61\s?4|04)", phone) is not None
            role_priority = (
                "PRIORITY"
                if any(key in str(contact["role"]).casefold() for key in (
                    "owner", "director", "general manager", "operations manager",
                    "plant manager", "mine manager", "procurement", "maintenance",
                    "engineering",
                ))
                else "SECONDARY"
            )
            sync = await self.sheets.upsert_contact({
                "contact_id": contact_id,
                "company_id": contact["company_id"],
                "name": contact["name"],
                "position": contact["role"],
                "role_bucket": contact["role"],
                "role_priority": role_priority,
                "business_email": contact.get("email", ""),
                "mobile": phone if is_mobile else "",
                "landline": phone if phone and not is_mobile else "",
                "contact_status": "NEW",
                "source_provenance": json.dumps({
                    "provider": "Public company website",
                    "source_url": contact.get("source_url", ""),
                    "captured_at": datetime.now(timezone.utc).isoformat(),
                }, ensure_ascii=False),
                "source_quality_flags": "PUBLIC_SITE_EVIDENCE; NEEDS_USER_REVIEW",
                "last_modified": datetime.now(timezone.utc).isoformat(),
            })
            if sync.value != "SYNCED":
                job.result_rows_synced = False
                job.warnings.append(
                    f"Contact {contact['name']} was found but its Contacts-tab write is pending."
                )

        step.result = {
            "website_candidates": len(websites),
            "websites_crawled": len(selected) - sum(bool(error) for _, _, error in crawl_results),
            "people_found": len(job.contacts_found),
            "channels_without_named_people": sum(bool(result[1]) for result in crawl_results),
        }
        step.status = StepStatus.COMPLETED
        step.completed_at = datetime.now(timezone.utc)

    async def _step_evaluate(self, job: ResearchJob) -> None:
        """Step 4: Score industry fit and prioritize results."""
        step = job.steps[3]
        step.status = StepStatus.RUNNING
        step.started_at = datetime.now(timezone.utc)

        for company in job.companies_found:
            # ABR's name-search terms do not establish an entity's industry.
            # Leave fit and priority blank until the Sheet carries verified
            # industry evidence from a source that actually publishes it.
            company["industry_fit"] = ""
            company["priority"] = ""
            flags = str(company.get("source_quality_flags", ""))
            if "INDUSTRY_UNVERIFIED" not in flags:
                company["source_quality_flags"] = "; ".join(
                    item for item in [flags, "INDUSTRY_UNVERIFIED"] if item
                )

            # Count contacts for this company
            company_contacts = [c for c in job.contacts_found if c.get("company") == company.get("name")]
            company["contacts_count"] = len(company_contacts)
            company["has_priority_contact"] = any(
                c.get("role", "").lower() in [
                    "plant manager", "operations manager", "general manager",
                    "owner", "managing director",
                ]
                for c in company_contacts
            )

        step.result = {
            "targets": sum(1 for c in job.companies_found if c.get("industry_fit") == "TARGET"),
            "adjacent": sum(1 for c in job.companies_found if c.get("industry_fit") == "ADJACENT"),
            "unlikely": sum(1 for c in job.companies_found if c.get("industry_fit") == "UNLIKELY"),
            "unclassified": sum(1 for c in job.companies_found if not c.get("industry_fit")),
        }
        step.status = StepStatus.COMPLETED
        step.completed_at = datetime.now(timezone.utc)


def _digits(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _provider_ids_from_provenance(value: object) -> set[str]:
    if not isinstance(value, str) or not value.strip():
        return set()
    try:
        payload = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return set()
    if not isinstance(payload, dict):
        return set()
    provider_id = str(payload.get("provider_id") or "").strip()
    return {provider_id} if provider_id else set()


def _blend_public_source_candidates(
    primary_results: list[dict], web_results: list[dict]
) -> list[dict]:
    """Interleave web candidates with mapped results so the 30-row cap is diverse."""
    if not web_results:
        return list(primary_results)

    abr_results: list[dict] = []
    mapped_results: list[dict] = []
    for candidate in primary_results:
        if str(candidate.get("source") or "").upper() == "ABR":
            abr_results.append(candidate)
        else:
            mapped_results.append(candidate)

    # Keep a small ABR lead-in for QLD postcodes, but don't let either the
    # registry or a dense map area consume every slot before web discovery.
    interleaved = abr_results[:8]
    web_pool = web_results[:10]
    web_index = 0
    for offset in range(0, len(mapped_results), 2):
        interleaved.extend(mapped_results[offset : offset + 2])
        if web_index < len(web_pool):
            interleaved.append(web_pool[web_index])
            web_index += 1

    interleaved.extend(web_pool[web_index:])
    interleaved.extend(abr_results[8:])
    return interleaved


def _json_string_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    if not isinstance(value, str) or not value.strip():
        return []
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []
    return [str(item) for item in parsed if str(item)] if isinstance(parsed, list) else []


def _safe_int(value: object) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _safe_float(value: object) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _role_matches(target: str, discovered: str) -> bool:
    """Compare explicit published roles while allowing common synonyms."""
    aliases = {
        "purchasing": "procurement",
        "buyer": "procurement",
        "mine manager": "mining manager",
        "site supervisor": "site manager",
        "chief executive officer": "ceo",
        "chief executive": "ceo",
    }

    def normalize(value: str) -> str:
        normalized = " ".join(re.sub(r"[^a-z0-9]+", " ", value.casefold()).split())
        for source, replacement in aliases.items():
            normalized = re.sub(rf"\b{re.escape(source)}\b", replacement, normalized)
        return normalized

    target_value = normalize(target)
    discovered_value = normalize(discovered)
    return bool(
        target_value
        and discovered_value
        and (target_value == discovered_value
             or target_value in discovered_value
             or discovered_value in target_value)
    )
