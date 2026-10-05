"""Opt-in local fastCRW search provider; no Firecrawl or model billing fallback."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.services.firecrawl_search import FirecrawlSearchDiscovery


class FastCRWSearchDiscovery(FirecrawlSearchDiscovery):
    provider_name = "fastCRW + SearXNG self-hosted search"
    provider_key = "fastcrw"
    source = "FASTCRW_SEARCH"
    credential_note = (
        "Self-hosted search uses the GenLead VPS fastCRW and SearXNG services. "
        "It does not use Firecrawl or AI-model credits; live availability is checked when a search runs."
    )

    def __init__(
        self,
        *,
        geocoder: Any,
        base_url: str = "http://127.0.0.1:3127",
        service_api_key: str = "",
        **kwargs: Any,
    ):
        parts = urlsplit(base_url)
        if (parts.scheme != "http" or parts.hostname not in {"127.0.0.1", "::1"}
                or parts.username is not None or parts.password is not None
                or parts.path not in {"", "/"} or parts.query or parts.fragment):
            raise ValueError("fastCRW must use an HTTP literal-loopback URL without credentials or a path.")
        if not parts.port:
            raise ValueError("fastCRW local server URL must specify a port.")
        if "api_key" in kwargs:
            raise ValueError("Use a local service token, not a Firecrawl provider API key.")
        if service_api_key and (
            len(service_api_key) < 32
            or len(service_api_key) > 512
            or not re.fullmatch(r"[A-Za-z0-9_-]+", service_api_key)
        ):
            raise ValueError("The local fastCRW service token has an invalid format.")
        self._service_api_key = service_api_key
        super().__init__(geocoder=geocoder, api_key="", **kwargs)
        self.search_url = f"{base_url.rstrip('/')}/firecrawl/v2/search"

    def _authorization_headers(self) -> dict[str, str]:
        if not self._service_api_key:
            return {}
        return {"Authorization": f"Bearer {self._service_api_key}"}

    def _http_error_message(self, status_code: int) -> str:
        if status_code in {422, 502, 503}:
            return (
                "fastCRW local search could not complete. Check the VPS SearXNG service, its JSON search "
                "format, and the local service connection; mapped-place and saved-workbook results remain available."
            )
        return super()._http_error_message(status_code)


def create_web_search(*, geocoder: Any) -> FirecrawlSearchDiscovery:
    """Keep Firecrawl behavior as the default; select local search explicitly."""
    provider = os.environ.get("GENLEAD_WEB_SEARCH_PROVIDER", "firecrawl").strip().casefold()
    if provider == "firecrawl":
        return FirecrawlSearchDiscovery(geocoder=geocoder)
    if provider == "fastcrw":
        service_api_key = ""
        key_file = os.environ.get("FASTCRW_API_KEY_FILE", "").strip()
        if key_file:
            try:
                service_api_key = Path(key_file).read_text(encoding="utf-8").strip()
            except OSError as exc:
                raise RuntimeError("The local fastCRW service token file could not be read.") from exc
        return FastCRWSearchDiscovery(
            geocoder=geocoder,
            base_url=os.environ.get("FASTCRW_BASE_URL", "http://127.0.0.1:3127"),
            service_api_key=service_api_key,
        )
    raise ValueError("Unsupported GenLead web-search provider; choose firecrawl or fastcrw.")
