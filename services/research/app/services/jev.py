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
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum

from app.services.abr import ABRAdapter
from app.services.crawler import WebsiteCrawler, SSRFError, CrawlLimitError
from app.services.resolver import EntityResolver, normalize_company_name


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
    status: str = "running"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    steps: list[PipelineStep] = field(default_factory=list)
    companies_found: list[dict] = field(default_factory=list)
    contacts_found: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


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

    def __init__(self):
        self.abr = ABRAdapter()
        self.crawler = WebsiteCrawler()
        self.resolver = EntityResolver()

    async def start_research(
        self,
        postcode: str,
        industry: str | None = None,
        target_roles: list[str] | None = None,
    ) -> ResearchJob:
        """Start a new research job for a postcode.

        Creates a job with 4 pipeline steps and begins execution.
        Returns the job immediately -- poll status via get_job().
        """
        job = ResearchJob(
            job_id=str(uuid.uuid4()),
            postcode=postcode,
            industry=industry,
            target_roles=target_roles or [],
            steps=[
                PipelineStep(name="discover"),
                PipelineStep(name="verify"),
                PipelineStep(name="research_contacts"),
                PipelineStep(name="evaluate"),
            ],
        )
        _jobs[job.job_id] = job

        # Run pipeline in background
        asyncio.create_task(self._run_pipeline(job))
        return job

    async def get_job(self, job_id: str) -> ResearchJob | None:
        return _jobs.get(job_id)

    async def list_jobs(self) -> list[ResearchJob]:
        return list(_jobs.values())

    async def cancel_job(self, job_id: str) -> bool:
        job = _jobs.get(job_id)
        if job and job.status == "running":
            job.status = "cancelled"
            return True
        return False

    async def _run_pipeline(self, job: ResearchJob) -> None:
        """Execute the full research pipeline."""
        try:
            await self._step_discover(job)
            if job.status == "cancelled":
                return

            await self._step_verify(job)
            if job.status == "cancelled":
                return

            await self._step_research_contacts(job)
            if job.status == "cancelled":
                return

            await self._step_evaluate(job)

            job.status = "completed"
        except Exception as e:
            job.status = "failed"
            job.errors.append(f"Pipeline error: {str(e)}")

    async def _step_discover(self, job: ResearchJob) -> None:
        """Step 1: Discover companies in the postcode area."""
        step = job.steps[0]
        step.status = StepStatus.RUNNING
        step.started_at = datetime.now(timezone.utc)

        try:
            # Search ABR for businesses in the postcode
            results = await self.abr.search_by_postcode(job.postcode)

            # Filter by industry if specified
            if job.industry:
                industry_lower = job.industry.lower()
                results = [r for r in results if industry_lower in r.get("industry", "").lower()]

            # Deduplicate using entity resolver
            resolved = self.resolver.resolve_companies(
                [{"name": r.get("name", ""), "abn": r.get("abn", "")} for r in results]
            )

            # Keep the full company dicts (with website, etc.) for downstream steps.
            # The resolver returns canonical records keyed by company_name; map them
            # back and enrich with the original fields (website, postcode, state).
            merged_names = {
                normalize_company_name(m.get("company_name", ""))
                for m in resolved.get("merged", [])
            }
            seen: set[str] = set()
            enriched: list[dict] = []
            for r in results:
                norm = normalize_company_name(r.get("name", ""))
                if norm not in seen:
                    seen.add(norm)
                    enriched.append(dict(r))  # shallow copy
            job.companies_found = enriched

            step.result = {
                "companies_discovered": len(job.companies_found),
                "duplicates_merged": resolved.get("duplicates_merged", 0),
            }
            step.status = StepStatus.COMPLETED
            step.completed_at = datetime.now(timezone.utc)

        except Exception as e:
            step.status = StepStatus.NEEDS_REVIEW
            step.error = str(e)
            job.warnings.append(f"Discovery had issues: {e}. Manual review needed.")

    async def _step_verify(self, job: ResearchJob) -> None:
        """Step 2: Verify ABN status and operating sites."""
        step = job.steps[1]
        step.status = StepStatus.RUNNING
        step.started_at = datetime.now(timezone.utc)

        verified_count = 0
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
                    company["verification"] = "VERIFIED"
                    company["abn_status"] = "Active"
                    company["registered_name"] = entity.name
                    verified_count += 1
                elif entity:
                    company["verification"] = "NEEDS_REVIEW"
                    company["verification_note"] = f"ABN status: {entity.status}"
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

        step.result = {"verified": verified_count, "needs_review": review_count}
        step.status = StepStatus.COMPLETED
        step.completed_at = datetime.now(timezone.utc)

    async def _step_research_contacts(self, job: ResearchJob) -> None:
        """Step 3: Find contacts via website crawling."""
        step = job.steps[2]
        step.status = StepStatus.RUNNING
        step.started_at = datetime.now(timezone.utc)

        contacts_found = 0

        for company in job.companies_found:
            website = company.get("website", "")
            if not website:
                continue

            try:
                crawl_result = await self.crawler.crawl_website(website)
                extracted = await self.crawler.extract_contacts(crawl_result.body)

                for contact in extracted:
                    # Check if contact role matches target roles
                    role = contact.role or ""
                    role_match = not job.target_roles or any(
                        tr.lower() in role.lower() for tr in job.target_roles
                    )

                    if role_match or not job.target_roles:
                        job.contacts_found.append({
                            "name": contact.name,
                            "role": contact.role,
                            "email": contact.email,
                            "phone": contact.phone,
                            "company": company.get("name", ""),
                            "source_url": contact.source_url,
                            "verification": "UNVERIFIED",
                        })
                        contacts_found += 1

            except SSRFError as e:
                job.warnings.append(f"SSRF blocked for {website}: {e}")
            except CrawlLimitError as e:
                job.warnings.append(f"Crawl limit for {website}: {e}")
            except Exception as e:
                job.warnings.append(f"Crawl failed for {website}: {e}")

        step.result = {"contacts_found": contacts_found}
        step.status = StepStatus.COMPLETED
        step.completed_at = datetime.now(timezone.utc)

    async def _step_evaluate(self, job: ResearchJob) -> None:
        """Step 4: Score industry fit and prioritize results."""
        step = job.steps[3]
        step.status = StepStatus.RUNNING
        step.started_at = datetime.now(timezone.utc)

        target_keywords = {
            "mining": ["mining", "mineral", "ore", "coal", "quarry"],
            "energy": ["energy", "power", "electricity", "generation", "solar", "wind"],
            "heavy industry": ["industrial", "manufacturing", "plant", "processing", "refinery"],
            "construction": ["construction", "building", "civil", "infrastructure"],
            "transport": ["transport", "logistics", "freight", "rail", "shipping"],
        }

        for company in job.companies_found:
            industry = company.get("industry", "").lower()
            name = company.get("name", "").lower()
            combined = f"{industry} {name}"

            # Score based on keyword matches
            best_fit = "UNLIKELY"
            best_score = 0

            for category, keywords in target_keywords.items():
                score = sum(1 for kw in keywords if kw in combined)
                if score > best_score:
                    best_score = score
                    if score >= 2:
                        best_fit = "TARGET"
                    elif score >= 1:
                        best_fit = "ADJACENT"

            company["industry_fit"] = best_fit
            company["priority"] = 1 if best_fit == "TARGET" else 2 if best_fit == "ADJACENT" else 3

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

        # Sort by priority
        job.companies_found.sort(key=lambda c: c.get("priority", 99))

        step.result = {
            "targets": sum(1 for c in job.companies_found if c.get("industry_fit") == "TARGET"),
            "adjacent": sum(1 for c in job.companies_found if c.get("industry_fit") == "ADJACENT"),
            "unlikely": sum(1 for c in job.companies_found if c.get("industry_fit") == "UNLIKELY"),
        }
        step.status = StepStatus.COMPLETED
        step.completed_at = datetime.now(timezone.utc)
