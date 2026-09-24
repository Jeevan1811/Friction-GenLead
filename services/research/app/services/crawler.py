"""Website crawler with real SSRF protection.

Every URL is resolved and checked against blocked networks BEFORE any
HTTP request is made.  This is not a stub -- the safety checks are
production-grade.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
import time
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

import httpcore
import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Blocked IP networks (RFC 1918, loopback, link-local, CGN, metadata, etc.)
# ---------------------------------------------------------------------------

BLOCKED_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    # IPv4
    ipaddress.IPv4Network("10.0.0.0/8"),          # RFC 1918
    ipaddress.IPv4Network("172.16.0.0/12"),        # RFC 1918
    ipaddress.IPv4Network("192.168.0.0/16"),       # RFC 1918
    ipaddress.IPv4Network("127.0.0.0/8"),          # Loopback
    ipaddress.IPv4Network("169.254.0.0/16"),       # Link-local
    ipaddress.IPv4Network("100.64.0.0/10"),        # Carrier-grade NAT (RFC 6598)
    ipaddress.IPv4Network("0.0.0.0/8"),            # "This" network
    ipaddress.IPv4Network("192.0.0.0/24"),         # IETF protocol assignments
    ipaddress.IPv4Network("192.0.2.0/24"),         # Documentation (TEST-NET-1)
    ipaddress.IPv4Network("198.51.100.0/24"),      # Documentation (TEST-NET-2)
    ipaddress.IPv4Network("203.0.113.0/24"),       # Documentation (TEST-NET-3)
    ipaddress.IPv4Network("224.0.0.0/4"),          # Multicast
    ipaddress.IPv4Network("240.0.0.0/4"),          # Reserved
    ipaddress.IPv4Network("255.255.255.255/32"),   # Broadcast
    # Cloud metadata endpoints
    ipaddress.IPv4Network("169.254.169.254/32"),   # AWS / GCP / Azure metadata
    ipaddress.IPv4Network("169.254.170.2/32"),     # AWS ECS task metadata
    # IPv6
    ipaddress.IPv6Network("::1/128"),              # Loopback
    ipaddress.IPv6Network("fc00::/7"),             # Unique local (RFC 4193)
    ipaddress.IPv6Network("fe80::/10"),            # Link-local
    ipaddress.IPv6Network("::ffff:0:0/96"),        # IPv4-mapped IPv6
    ipaddress.IPv6Network("2001:db8::/32"),        # Documentation
    ipaddress.IPv6Network("ff00::/8"),             # Multicast
]

# Blocked hostnames that resolve to metadata services
BLOCKED_HOSTNAMES: set[str] = {
    "metadata.google.internal",
    "metadata",
    "instance-data",
}

# Allowed schemes
ALLOWED_SCHEMES: frozenset[str] = frozenset({"http", "https"})

# Limits
MAX_RESPONSE_BYTES = 5 * 1024 * 1024   # 5 MB
REQUEST_TIMEOUT_SECONDS = 15.0
MAX_PAGES_PER_DOMAIN = 50
MIN_REQUEST_INTERVAL_SECONDS = 2.0
MAX_REDIRECTS = 5


class SSRFError(Exception):
    """Raised when a URL targets a blocked network or host."""


class CrawlLimitError(Exception):
    """Raised when crawl limits are exceeded."""


@dataclass(frozen=True)
class _ResolvedTarget:
    hostname: str
    port: int
    addresses: tuple[str, ...]

    @property
    def key(self) -> tuple[str, int]:
        return self.hostname, self.port


class _PinnedAddressBackend(httpcore.AsyncNetworkBackend):
    """Connect only to IPs already resolved and validated by the crawler."""

    def __init__(
        self,
        addresses: dict[tuple[str, int], tuple[str, ...]],
        delegate: httpcore.AsyncNetworkBackend,
    ) -> None:
        self._addresses = addresses
        self._delegate = delegate

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ) -> httpcore.AsyncNetworkStream:
        normalized_host = host.encode("idna").decode("ascii").lower().rstrip(".")
        addresses = self._addresses.get((normalized_host, port))
        if not addresses:
            raise httpcore.ConnectError(
                f"No validated DNS result for {normalized_host}:{port}."
            )

        last_error: Exception | None = None
        for address in addresses:
            try:
                return await self._delegate.connect_tcp(
                    address,
                    port,
                    timeout=timeout,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last_error = exc

        if last_error is not None:
            raise last_error
        raise httpcore.ConnectError(
            f"No validated DNS result for {normalized_host}:{port}."
        )

    async def connect_unix_socket(
        self, path: str, timeout: float | None = None, socket_options=None
    ) -> httpcore.AsyncNetworkStream:
        return await self._delegate.connect_unix_socket(
            path, timeout=timeout, socket_options=socket_options
        )

    async def sleep(self, seconds: float) -> None:
        await self._delegate.sleep(seconds)


@dataclass
class ExtractedContact:
    """A contact extracted from a crawled web page."""
    name: str
    role: str
    email: str
    phone: str
    source_url: str


@dataclass
class CrawlResult:
    url: str
    status_code: int
    content_type: str
    body: str
    elapsed_ms: float


@dataclass
class WebsiteCrawler:
    """Crawl public websites with SSRF protection and rate limiting."""

    _domain_timestamps: dict[str, float] = field(default_factory=dict)
    _domain_page_counts: dict[str, int] = field(default_factory=dict)

    # ------------------------------------------------------------------
    # SSRF validation
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_scheme(url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in ALLOWED_SCHEMES:
            raise SSRFError(
                f"Scheme '{parsed.scheme}' is not allowed. "
                f"Only {ALLOWED_SCHEMES} are permitted."
            )

    @staticmethod
    def _validate_hostname(hostname: str) -> None:
        if not hostname:
            raise SSRFError("Empty hostname is not allowed.")

        lower = hostname.lower().rstrip(".")
        if lower in BLOCKED_HOSTNAMES:
            raise SSRFError(f"Hostname '{hostname}' is blocked (metadata service).")

        # Block numeric-only hostnames that could be octal/hex IP tricks
        try:
            ipaddress.ip_address(lower)
            # If it parses as an IP, we validate it below via _validate_ip.
        except ValueError:
            pass  # Normal hostname -- fine.

    @staticmethod
    def _validate_ip(ip_str: str) -> None:
        try:
            addr = ipaddress.ip_address(ip_str)
        except ValueError:
            raise SSRFError(f"Could not parse IP address '{ip_str}'.")

        for network in BLOCKED_NETWORKS:
            if addr in network:
                raise SSRFError(
                    f"IP {addr} falls within blocked network {network}."
                )

    def _resolve_and_validate(self, url: str) -> _ResolvedTarget:
        """Resolve a URL and return only its validated connection addresses."""
        self._validate_scheme(url)

        parsed = urlparse(url)
        hostname = parsed.hostname or ""
        self._validate_hostname(hostname)

        # Resolve DNS
        try:
            addr_infos = socket.getaddrinfo(
                hostname, parsed.port or (443 if parsed.scheme == "https" else 80),
                proto=socket.IPPROTO_TCP,
            )
        except socket.gaierror as exc:
            raise SSRFError(f"DNS resolution failed for '{hostname}': {exc}")

        if not addr_infos:
            raise SSRFError(f"No DNS results for '{hostname}'.")

        # Validate EVERY resolved IP (not just the first)
        addresses: list[str] = []
        for family, _type, _proto, _canonname, sockaddr in addr_infos:
            ip_str = sockaddr[0]
            self._validate_ip(ip_str)
            if ip_str not in addresses:
                addresses.append(ip_str)

        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        normalized_hostname = (
            hostname.encode("idna").decode("ascii").lower().rstrip(".")
        )
        return _ResolvedTarget(normalized_hostname, port, tuple(addresses))

    # ------------------------------------------------------------------
    # Rate limiting
    # ------------------------------------------------------------------

    def _enforce_rate_limit(self, domain: str) -> None:
        now = time.monotonic()
        last = self._domain_timestamps.get(domain, 0.0)
        wait = MIN_REQUEST_INTERVAL_SECONDS - (now - last)
        if wait > 0:
            time.sleep(wait)
        self._domain_timestamps[domain] = time.monotonic()

    def _enforce_page_limit(self, domain: str) -> None:
        count = self._domain_page_counts.get(domain, 0)
        if count >= MAX_PAGES_PER_DOMAIN:
            raise CrawlLimitError(
                f"Page limit ({MAX_PAGES_PER_DOMAIN}) reached for domain '{domain}'."
            )
        self._domain_page_counts[domain] = count + 1

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def fetch(self, url: str) -> CrawlResult:
        """Fetch a single URL with full SSRF protection.

        Raises:
            SSRFError: URL targets a private/blocked network.
            CrawlLimitError: Domain page limit exceeded.
            httpx.HTTPError: Network-level failure.
        """
        target = self._resolve_and_validate(url)
        domain = target.hostname
        self._enforce_page_limit(domain)
        self._enforce_rate_limit(domain)

        start = time.monotonic()
        pinned_addresses = {target.key: target.addresses}
        transport = httpx.AsyncHTTPTransport(trust_env=False)
        pool = getattr(transport, "_pool", None)
        if pool is None or not hasattr(pool, "_network_backend"):
            await transport.aclose()
            raise RuntimeError("HTTPX transport cannot install the validated DNS backend.")
        # HTTPX does not expose a public custom-network-backend constructor.
        # Replace the pool backend before the first connection; fail closed if
        # a future HTTPX version changes this transport internals contract.
        pool._network_backend = _PinnedAddressBackend(
            pinned_addresses,
            delegate=pool._network_backend,
        )

        async with httpx.AsyncClient(
            transport=transport,
            timeout=REQUEST_TIMEOUT_SECONDS,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            current_url = url
            for redirect_count in range(MAX_REDIRECTS + 1):
                response = await client.get(
                    current_url,
                    headers={
                        "User-Agent": (
                            "FrictionGenLead/0.1 "
                            "(+https://frictiongenlead.com.au/bot)"
                        ),
                    },
                )

                if not response.is_redirect:
                    break

                location = response.headers.get("location")
                if not location:
                    break
                if redirect_count == MAX_REDIRECTS:
                    raise CrawlLimitError(
                        f"Redirect limit ({MAX_REDIRECTS}) exceeded."
                    )

                # Resolve relative locations and validate the destination before
                # making any request to it. Never let httpx follow a redirect
                # automatically, since that would contact the target first.
                current_url = urljoin(current_url, location)
                redirect_target = self._resolve_and_validate(current_url)
                pinned_addresses[redirect_target.key] = redirect_target.addresses
                self._enforce_rate_limit(redirect_target.hostname)

            # Enforce size limit
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > MAX_RESPONSE_BYTES:
                raise CrawlLimitError(
                    f"Response too large: {content_length} bytes "
                    f"(limit {MAX_RESPONSE_BYTES})."
                )

            body = response.text
            if len(body.encode("utf-8", errors="replace")) > MAX_RESPONSE_BYTES:
                raise CrawlLimitError(
                    f"Response body exceeds {MAX_RESPONSE_BYTES} byte limit."
                )

        elapsed = (time.monotonic() - start) * 1000

        return CrawlResult(
            url=str(response.url),
            status_code=response.status_code,
            content_type=response.headers.get("content-type", ""),
            body=body,
            elapsed_ms=round(elapsed, 1),
        )

    async def crawl_website(self, url: str) -> CrawlResult:
        """Fetch a website's main page for contact extraction.

        Convenience wrapper around :meth:`fetch` that Jev uses in the
        contact-research step.  Returns a :class:`CrawlResult` whose
        ``body`` contains the page HTML.
        """
        return await self.fetch(url)

    async def extract_contacts(self, html: str) -> list["ExtractedContact"]:
        """Extract contacts from raw HTML.

        Looks for common patterns: mailto links, "Contact Us" sections,
        team/about pages.  Returns a list of :class:`ExtractedContact`
        objects.  Currently a stub that returns mock contacts; will be
        replaced with real HTML parsing.
        """
        contacts: list[ExtractedContact] = []

        # Simple mailto extraction (real implementation)
        import re
        mailto_pattern = re.compile(r'mailto:([^"\'?\s]+)', re.IGNORECASE)
        emails_found = set(mailto_pattern.findall(html))

        for email in emails_found:
            contacts.append(ExtractedContact(
                name="",
                role="",
                email=email.strip(),
                phone="",
                source_url="",
            ))

        # If no emails found via mailto, return empty (no fabrication)
        return contacts

    async def crawl_site(self, base_url: str, max_pages: int | None = None) -> list[CrawlResult]:
        """Crawl multiple pages from a site starting at base_url.

        This is a stub that currently only fetches the base URL.
        Full crawling (link extraction, deduplication, robots.txt) will be
        added when the real integration is built.
        """
        limit = min(max_pages or MAX_PAGES_PER_DOMAIN, MAX_PAGES_PER_DOMAIN)
        results: list[CrawlResult] = []

        result = await self.fetch(base_url)
        results.append(result)

        # TODO: extract links from HTML, respect robots.txt, BFS/DFS
        # up to `limit` pages.

        logger.info(
            "Crawled %d page(s) from %s (limit %d)",
            len(results),
            base_url,
            limit,
        )
        return results
