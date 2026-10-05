# GenLead self-hosted web search

This stack is isolated to the Friction GenLead VPS. It uses fastCRW `v0.37.2` as a local Firecrawl-compatible search API and SearXNG `2026.5.9-0cba32c15` for metasearch. Both listeners are loopback-only. A separate random internal service token restricts fastCRW to GenLead; no OpenRouter or Firecrawl credential is required.

SearXNG settings, fastCRW auth config, and the internal token are generated on the VPS from the templates; secret values must never be committed or printed. The fastCRW runtime config is named `config.genlead.toml` and loaded with `CRW_CONFIG=config.genlead`. Generate the internal token as hexadecimal and serialize it as a quoted TOML string. The token file and runtime config are owned by `root:frictiongenlead` with mode `0640`, so only root and the app service group can read them. The fastCRW binary is installed from the official GitHub release only after its published SHA-256 is verified. The systemd unit runs under the app service user with a 512 MiB memory cap.

Pinned fastCRW artifact: `crw-server-linux-x64.tar.gz`, SHA-256 `1c0b6f7458b4a09409a2f618995f96d5fdd27f0a277239346cba4843e87b2cd4`.

GenLead uses this provider only when `GENLEAD_WEB_SEARCH_PROVIDER=fastcrw`; its default remains Firecrawl for environments that do not opt in. Search results are unverified candidates, and external SearXNG engines may rate-limit or return fewer results than requested. The app's 100-company target is best-effort, not guaranteed.
