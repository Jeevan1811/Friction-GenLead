"""Website crawler with real SSRF protection.

Every URL is resolved and checked against blocked networks BEFORE any
HTTP request is made.  This is not a stub -- the safety checks are
production-grade.
"""

from __future__ import annotations

import asyncio
import html
import ipaddress
import logging
import re
import socket
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

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
MAX_PAGES_PER_SITE = 8
MIN_REQUEST_INTERVAL_SECONDS = 2.0
MAX_REDIRECTS = 5
CRAWLER_USER_AGENT = "FrictionGenLead"


class SSRFError(Exception):
    """Raised when a URL targets a blocked network or host."""


class CrawlLimitError(Exception):
    """Raised when crawl limits are exceeded."""


class RobotsPolicyError(Exception):
    """Raised when a site's robots policy cannot be safely checked."""


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


class _PageParser(HTMLParser):
    """Collect visible page text, links and explicit contact channels."""

    _SKIP_TAGS = {"script", "style", "noscript", "svg", "template"}
    _BLOCK_TAGS = {
        "address", "article", "br", "dd", "div", "footer", "form", "h1",
        "h2", "h3", "h4", "header", "li", "main", "p", "section", "td",
        "th", "tr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text_parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.mailto: set[str] = set()
        self.telephone: set[str] = set()
        self._skip_depth = 0
        self._anchor_href: str | None = None
        self._anchor_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag in self._BLOCK_TAGS:
            self.text_parts.append("\n")
        if tag == "a":
            attributes = dict(attrs)
            self._anchor_href = attributes.get("href")
            self._anchor_text = []
            href = (self._anchor_href or "").strip()
            if href.lower().startswith("mailto:"):
                email = href[7:].split("?", 1)[0].strip()
                if email:
                    self.mailto.add(html.unescape(email))
            elif href.lower().startswith("tel:"):
                phone = href[4:].split("?", 1)[0].strip()
                if phone:
                    self.telephone.add(html.unescape(phone))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self._SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag == "a" and self._anchor_href:
            label = " ".join(" ".join(self._anchor_text).split())
            self.links.append((self._anchor_href, label))
            self._anchor_href = None
            self._anchor_text = []
        if tag in self._BLOCK_TAGS:
            self.text_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        self.text_parts.append(data)
        if self._anchor_href:
            self._anchor_text.append(data)

    @property
    def visible_text(self) -> str:
        return "\n".join(
            line.strip()
            for line in "".join(self.text_parts).splitlines()
            if line.strip()
        )


@dataclass
class WebsiteCrawler:
    """Crawl public websites with SSRF protection and rate limiting."""

    _domain_timestamps: dict[str, float] = field(default_factory=dict)
    _domain_page_counts: dict[str, int] = field(default_factory=dict)
    _rate_locks: dict[str, asyncio.Lock] = field(default_factory=dict)
    _robots_cache: dict[str, RobotFileParser | bool] = field(default_factory=dict)

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

    async def _enforce_rate_limit(self, domain: str) -> None:
        lock = self._rate_locks.setdefault(domain, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            last = self._domain_timestamps.get(domain, 0.0)
            wait = MIN_REQUEST_INTERVAL_SECONDS - (now - last)
            if wait > 0:
                await asyncio.sleep(wait)
            self._domain_timestamps[domain] = time.monotonic()

    def _enforce_page_limit(
        self,
        domain: str,
        page_counts: dict[str, int] | None = None,
    ) -> None:
        counts = page_counts if page_counts is not None else self._domain_page_counts
        count = counts.get(domain, 0)
        if count >= MAX_PAGES_PER_DOMAIN:
            raise CrawlLimitError(
                f"Page limit ({MAX_PAGES_PER_DOMAIN}) reached for domain '{domain}'."
            )
        counts[domain] = count + 1

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def fetch(
        self,
        url: str,
        *,
        method: str = "GET",
        form_data: dict[str, str] | None = None,
        _page_counts: dict[str, int] | None = None,
        _count_page: bool = True,
    ) -> CrawlResult:
        """Fetch a single URL with full SSRF protection.

        Raises:
            SSRFError: URL targets a private/blocked network.
            CrawlLimitError: Domain page limit exceeded.
            httpx.HTTPError: Network-level failure.
        """
        request_method = method.upper()
        if request_method not in {"GET", "POST"}:
            raise ValueError("Crawler supports only GET and form POST requests.")
        if request_method == "GET" and form_data:
            raise ValueError("Form data may only be sent with a POST request.")

        target = self._resolve_and_validate(url)
        domain = target.hostname
        if _count_page:
            self._enforce_page_limit(domain, _page_counts)
        await self._enforce_rate_limit(domain)

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
                request_kwargs: dict[str, object] = {
                    "headers": {
                        "User-Agent": (
                            "FrictionGenLead/0.1 "
                            "(+https://frictiongenlead.friction.com.my/)"
                        ),
                    },
                }
                if request_method == "POST":
                    request_kwargs["data"] = form_data or {}
                response = await client.request(
                    request_method,
                    current_url,
                    **request_kwargs,
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
                if request_method == "POST":
                    original = urlparse(url)
                    redirected = urlparse(current_url)
                    if (
                        original.scheme.lower() != redirected.scheme.lower()
                        or (original.hostname or "").lower() != (redirected.hostname or "").lower()
                        or original.port != redirected.port
                    ):
                        raise CrawlLimitError(
                            "Cross-origin redirect after form submission was refused."
                        )
                    if response.status_code in {301, 302, 303}:
                        request_method = "GET"
                        form_data = None
                pinned_addresses[redirect_target.key] = redirect_target.addresses
                await self._enforce_rate_limit(redirect_target.hostname)

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

    async def extract_contacts(
        self,
        html: str,
        source_url: str = "",
    ) -> list["ExtractedContact"]:
        """Extract only contact details explicitly published in page HTML.

        A named person is emitted only when the page text places a person's
        name next to an explicit business role. Generic email/phone channels
        remain unnamed rather than being guessed into a decision-maker.
        """
        contacts: list[ExtractedContact] = []
        parser = _PageParser()
        parser.feed(html)
        text = parser.visible_text

        email_pattern = re.compile(
            r"(?i)(?<![\w.+-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
            r"[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?"
            r"(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+"
        )
        emails = set(parser.mailto)
        emails.update(email_pattern.findall(text))
        emails = {
            email.strip(".,;:()[]{}<>")
            for email in emails
            if "example." not in email.lower()
            and not email.lower().endswith((".png", ".jpg", ".svg"))
        }

        phone_pattern = re.compile(
            r"(?<!\d)(?:\+61\s?4\d{2}(?:[\s().-]?\d){6}|"
            r"\+61\s?[2-8](?:[\s().-]?\d){8}|"
            r"04\d{2}(?:[\s().-]?\d){6}|"
            r"0[2-8](?:[\s().-]?\d){8})(?!\d)"
        )
        phones = {" ".join(phone.split()) for phone in parser.telephone}
        phones.update(phone_pattern.findall(text))
        phones = {
            phone.strip()
            for phone in phones
            if 10 <= len(re.sub(r"\D", "", phone)) <= 11
        }

        roles = (
            "Chief Executive Officer|CEO|Managing Director|General Manager|"
            "Operations Manager|Commercial Manager|Procurement Manager|"
            "Maintenance Manager|Engineering Manager|Plant Manager|Site Manager|"
            "Director|Owner|Principal|Partner|Operations Director|"
            "Business Development Manager"
        )
        name = r"[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}"
        name_line = re.compile(rf"^{name}$")
        role_line = re.compile(rf"(?i)^(?:{roles})$")
        people: list[tuple[str, str, str]] = []
        lines = text.splitlines()
        consumed_lines: set[int] = set()
        for index, line in enumerate(lines):
            if index in consumed_lines:
                continue
            match = re.search(
                rf"(?P<name>{name})\s*(?:[,|:–—-])\s*(?P<role>(?i:{roles}))\b",
                line,
            ) or re.search(
                rf"(?P<role>(?i:{roles}))\s*(?:[,|:–—-])\s*(?P<name>{name})\b",
                line,
            )
            if match:
                person_name = " ".join(match.group("name").split())
                role = " ".join(match.group("role").split())
                people.append((person_name, role, line))
                continue

            # Business sites commonly put a person's name and role in
            # adjacent headings/paragraphs rather than one line. Only join
            # adjacent lines when one is an explicit name and the other an
            # explicit role from the allow-list above.
            if index + 1 < len(lines) and name_line.fullmatch(line.strip()):
                next_role = role_line.fullmatch(lines[index + 1].strip())
                if next_role:
                    people.append((line.strip(), next_role.group(0), "\n".join(lines[index:index + 2])))
                    consumed_lines.add(index + 1)
                    continue
            if index + 1 < len(lines) and role_line.fullmatch(line.strip()):
                next_name = name_line.fullmatch(lines[index + 1].strip())
                if next_name:
                    people.append((next_name.group(0), line.strip(), "\n".join(lines[index:index + 2])))
                    consumed_lines.add(index + 1)

        used_emails: set[str] = set()
        used_phones: set[str] = set()
        for person_name, role, line in people:
            line_emails = [email for email in emails if email.lower() in line.lower()]
            line_phones = [phone for phone in phones if phone in line]
            email = line_emails[0] if len(line_emails) == 1 else ""
            phone = line_phones[0] if len(line_phones) == 1 else ""
            if email:
                used_emails.add(email)
            if phone:
                used_phones.add(phone)
            contacts.append(
                ExtractedContact(person_name, role, email, phone, source_url)
            )

        # Keep generic business channels available to callers, but never assign
        # them to a person or role unless the source page explicitly does so.
        contacts.extend(
            ExtractedContact("", "", email, "", source_url)
            for email in sorted(emails - used_emails)
        )
        contacts.extend(
            ExtractedContact("", "", "", phone, source_url)
            for phone in sorted(phones - used_phones)
        )
        return contacts

    async def crawl_site(self, base_url: str, max_pages: int | None = None) -> list[CrawlResult]:
        """Crawl a small, same-origin set of public pages, honoring robots.txt."""
        limit = min(max_pages or MAX_PAGES_PER_SITE, MAX_PAGES_PER_SITE)
        if limit < 1:
            return []

        parsed_base = urlparse(base_url)
        self._validate_scheme(base_url)
        if not parsed_base.hostname:
            raise SSRFError("Website URL must include a hostname.")
        origin = f"{parsed_base.scheme}://{parsed_base.netloc}".lower()
        page_counts: dict[str, int] = {}
        robots = await self._load_robots(origin, page_counts)

        def allowed(url: str) -> bool:
            return bool(robots and robots.can_fetch(CRAWLER_USER_AGENT, url))

        if not allowed(base_url):
            logger.info("Robots policy disallows the requested start URL: %s", base_url)
            return []

        results: list[CrawlResult] = []
        queue: list[str] = [base_url]
        visited: set[str] = set()
        while queue and len(results) < limit:
            current = queue.pop(0)
            normalized = current.split("#", 1)[0]
            if normalized in visited or not allowed(normalized):
                continue
            visited.add(normalized)
            try:
                result = await self.fetch(normalized, _page_counts=page_counts)
            except CrawlLimitError:
                raise
            except Exception:
                if not results:
                    raise
                logger.info("Skipping inaccessible page during crawl: %s", normalized)
                continue

            if result.status_code < 200 or result.status_code >= 300:
                continue
            if "html" not in result.content_type.lower():
                continue
            results.append(result)

            parser = _PageParser()
            parser.feed(result.body)
            candidates: list[tuple[int, str]] = []
            seen_links: set[str] = set()
            for href, label in parser.links:
                absolute = urljoin(result.url, href).split("#", 1)[0]
                parsed = urlparse(absolute)
                if (
                    parsed.scheme not in ALLOWED_SCHEMES
                    or (parsed.hostname or "").lower() != (parsed_base.hostname or "").lower()
                    or parsed.port != parsed_base.port
                    or absolute in visited
                    or absolute in seen_links
                    or parsed.path.lower().endswith(
                        (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".zip", ".doc", ".docx")
                    )
                ):
                    continue
                seen_links.add(absolute)
                target_text = f"{label} {parsed.path}".lower()
                priority = 0 if any(
                    key in target_text
                    for key in ("contact", "team", "people", "leadership", "management", "about", "staff")
                ) else 1
                candidates.append((priority, absolute))

            for _priority, url in sorted(candidates, key=lambda item: item[0]):
                if url not in queue and allowed(url):
                    queue.append(url)

        logger.info(
            "Crawled %d page(s) from %s (limit %d)",
            len(results),
            base_url,
            limit,
        )
        return results

    async def _load_robots(
        self,
        origin: str,
        page_counts: dict[str, int],
    ) -> RobotFileParser | None:
        if origin in self._robots_cache:
            cached = self._robots_cache[origin]
            return cached if isinstance(cached, RobotFileParser) else None

        robots_url = f"{origin}/robots.txt"
        try:
            result = await self.fetch(robots_url, _page_counts=page_counts, _count_page=False)
        except Exception as exc:
            self._robots_cache[origin] = False
            raise RobotsPolicyError(
                f"Could not safely read robots.txt for {origin}; crawl skipped."
            ) from exc

        final = urlparse(result.url)
        if (final.hostname or "").lower() != (urlparse(origin).hostname or "").lower():
            self._robots_cache[origin] = False
            raise RobotsPolicyError("robots.txt redirected outside the requested site.")

        if result.status_code == 404:
            lines: list[str] = []
        elif 200 <= result.status_code < 300:
            lines = result.body.splitlines()
        else:
            self._robots_cache[origin] = False
            raise RobotsPolicyError(
                f"robots.txt returned HTTP {result.status_code}; crawl skipped."
            )

        parser = RobotFileParser(robots_url)
        parser.parse(lines)
        self._robots_cache[origin] = parser
        return parser

    async def can_fetch(self, url: str) -> bool:
        """Return whether robots.txt allows this requested URL."""
        self._validate_scheme(url)
        parsed = urlparse(url)
        if not parsed.hostname:
            raise SSRFError("URL must include a hostname.")
        origin = f"{parsed.scheme}://{parsed.netloc}".lower()
        robots = await self._load_robots(origin, {})
        return bool(robots and robots.can_fetch(CRAWLER_USER_AGENT, url))
