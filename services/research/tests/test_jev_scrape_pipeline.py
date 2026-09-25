from __future__ import annotations

import asyncio

from app.services.abr import ABREntity
from app.services.crawler import CrawlResult, ExtractedContact
from app.services.jev import Jev, PipelineStep, ResearchJob, _role_matches


ABN_FIXTURE = "19415776361"


class _FakeABR:
    last_warnings: list[str] = []

    async def search_by_postcode(self, postcode: str, industry: str | None = None) -> list[dict]:
        return [{
            "abn": ABN_FIXTURE,
            "name": "Northside Industrial Pty Ltd",
            "status": "Active",
            "state": "QLD",
            "postcode": postcode,
            "business_names": ["Northside Industrial Services"],
            "matched_terms": [industry or "mining"],
            "source_url": f"https://abr.business.gov.au/ABN/View?abn={ABN_FIXTURE}",
            "website": "https://northside.example/",
        }]

    async def lookup_abn(self, abn: str) -> ABREntity:
        return ABREntity(
            abn=abn,
            name="Northside Industrial Pty Ltd",
            status="Active",
            state="QLD",
            postcode="4740",
        )


class _FakeCrawler:
    async def crawl_site(self, website: str, max_pages: int = 4) -> list[CrawlResult]:
        return [CrawlResult(website, 200, "text/html", "<html>public source</html>", 1)]

    async def extract_contacts(self, body: str, source_url: str) -> list[ExtractedContact]:
        return [ExtractedContact(
            "Taylor Smith",
            "Procurement Manager",
            "taylor@example.com",
            "0412 345 678",
            source_url,
        )]


def test_real_pipeline_shape_uses_explicit_public_evidence_and_role_matching():
    job = ResearchJob(
        job_id="job-offline-fixture",
        postcode="4740",
        industry="Mining",
        target_roles=["Purchasing Manager"],
        steps=[
            PipelineStep(name="discover"),
            PipelineStep(name="verify"),
            PipelineStep(name="research_contacts"),
            PipelineStep(name="evaluate"),
        ],
    )
    service = Jev(sheets=None, abr=_FakeABR(), crawler=_FakeCrawler())

    asyncio.run(service._run_pipeline(job))

    assert job.status == "completed", (job.errors, job.steps[0].error)
    assert len(job.companies_found) == 1
    company = job.companies_found[0]
    assert company["abn"] == ABN_FIXTURE
    assert company["trading_name"] == "Northside Industrial Services"
    assert company["verification"] == "ABN_ACTIVE"
    assert company["industry_fit"] == ""
    assert "INDUSTRY_UNVERIFIED" in company["source_quality_flags"]
    assert len(job.contacts_found) == 1
    assert job.contacts_found[0]["role"] == "Procurement Manager"
    assert job.contacts_found[0]["verification"] == "UNVERIFIED"
    assert job.contacts_found[0]["source_url"] == "https://northside.example/"


def test_role_matching_handles_purchasing_procurement_alias():
    assert _role_matches("Purchasing Manager", "Procurement Manager")
    assert not _role_matches("Site Manager", "Finance Manager")


def test_persisted_job_results_reload_only_the_saved_ids():
    class FakeSheets:
        async def read_companies(self):
            return [
                {"company_id": "company-keep", "company_name": "Saved company"},
                {"company_id": "company-other", "company_name": "Unrelated company"},
            ]

        async def read_contacts(self):
            return [
                {"contact_id": "contact-keep", "name": "Saved person"},
                {"contact_id": "contact-other", "name": "Unrelated person"},
            ]

    job = ResearchJob(
        job_id="restored-job",
        postcode="4740",
        industry="Mining",
        target_roles=[],
        result_company_ids=["company-keep"],
        result_contact_ids=["contact-keep"],
        details_available=True,
    )

    restored = asyncio.run(Jev(sheets=FakeSheets()).get_job_results(job))

    assert [row["company_id"] for row in restored.companies_found] == ["company-keep"]
    assert [row["contact_id"] for row in restored.contacts_found] == ["contact-keep"]


def test_discovery_stops_for_review_when_sheet_dedupe_reads_failed():
    class FailedReadSheets:
        async def read_companies(self):
            return []  # The adapter's legacy read contract returns empty on error.

        async def read_rejected(self):
            return []

        def tab_read_error(self, tab_key: str):
            return "temporary Sheets API failure" if tab_key == "companies" else None

        async def upsert_company(self, _company):
            raise AssertionError("No candidate may be written without successful dedupe reads.")

    job = ResearchJob(
        job_id="job-sheets-read-failed",
        postcode="4740",
        industry="Mining",
        target_roles=[],
        steps=[PipelineStep(name=name) for name in ("discover", "verify", "research_contacts", "evaluate")],
    )

    asyncio.run(Jev(sheets=FailedReadSheets(), abr=_FakeABR())._step_discover(job))

    assert job.steps[0].status.value == "needs_review"
    assert job.companies_found == []
    assert "could not safely deduplicate" in (job.steps[0].error or "").lower()


def test_discovery_stops_for_review_when_sheet_dedupe_reads_failed():
    class FailedReadSheets:
        async def read_companies(self):
            return []  # The adapter's legacy read contract returns empty on error.

        async def read_rejected(self):
            return []

        def tab_read_error(self, tab_key: str):
            return "temporary Sheets API failure" if tab_key == "companies" else None

        async def upsert_company(self, _company):
            raise AssertionError("No candidate may be written without successful dedupe reads.")

    job = ResearchJob(
        job_id="job-sheets-read-failed",
        postcode="4740",
        industry="Mining",
        target_roles=[],
        steps=[PipelineStep(name=name) for name in ("discover", "verify", "research_contacts", "evaluate")],
    )

    asyncio.run(Jev(sheets=FailedReadSheets(), abr=_FakeABR())._step_discover(job))

    assert job.steps[0].status.value == "needs_review"
    assert job.companies_found == []
    assert "could not safely deduplicate" in (job.steps[0].error or "").lower()
