"""Run the real FastAPI backend against FICTIONAL data, for capturing guide
screenshots (see capture.mjs). Never point screenshot tooling at the live
Sheet: it holds the client's real customer list and this repo is public.

    python scripts/guides/demo_backend.py     # serves http://localhost:8001

Requires AUTH_JWT_SECRET in the environment (same value the frontend uses).
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Force mock mode BEFORE the app (and its dotenv loading) is imported, so this
# can never connect to the real Google Sheet even if a real .env is present.
for var in ("GOOGLE_OAUTH_TOKEN_PATH", "GOOGLE_OAUTH_CLIENT_SECRET_PATH",
            "GOOGLE_SHEETS_CREDENTIALS_PATH", "GOOGLE_SHEETS_SPREADSHEET_ID"):
    os.environ[var] = ""

RESEARCH_DIR = Path(__file__).resolve().parents[2] / "services" / "research"
sys.path.insert(0, str(RESEARCH_DIR))

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402
from app.services.sheets_instance import sheets_adapter  # noqa: E402

NOW = datetime.now(timezone.utc).isoformat()

# (id, name, abn, status, industry, site, type, address, suburb, postcode)
COMPANIES = [
    ("n1", "Northern Ridge Mining Pty Ltd", "51 000 000 011", "NEW", "Mining", "Ridge Creek Mine", "MINE", "Peak Downs Hwy", "Moranbah", "4744"),
    ("n2", "Coastal Pumps QLD", "51 000 000 022", "APPROVED", "Manufacturing", "Coastal Pumps Depot", "DEPOT", "14 Harbour St", "Gladstone", "4680"),
    ("n3", "Burnett Valley Engineering", "", "REVIEW", "Heavy Industry", "Burnett Works", "PLANT", "22 Mill Rd", "Bundaberg", "4670"),
    ("n4", "Red Dust Haulage Pty Ltd", "51 000 000 044", "NEW", "Transport", "Red Dust Yard", "DEPOT", "8 Quarry Ln", "Emerald", "4720"),
    ("n5", "Callide Basin Power Services", "51 000 000 055", "APPROVED", "Energy", "Basin Power Station", "PLANT", "Callide Dam Rd", "Biloela", "4715"),
    ("n6", "Bluewater Marine Supplies", "", "NEW", "Transport", "Bluewater Store", "OFFICE", "3 Marina Way", "Mackay", "4740"),
    ("n7", "Ironbark Fabrication", "51 000 000 077", "STALE", "Manufacturing", "Ironbark Workshop", "PLANT", "5 Foundry Ct", "Rockhampton", "4700"),
    ("n8", "Mackay Reef Logistics", "51 000 000 088", "NEW", "Transport", "Reef Freight Terminal", "DEPOT", "40 Port Rd", "Mackay", "4740"),
    ("n9", "Stanhope Coal Handling", "51 000 000 099", "REVIEW", "Mining", "Stanhope Loadout", "MINE", "Rail Access Rd", "Blackwater", "4717"),
    ("n10", "Emerald Plains Mechanical", "", "NEW", "Construction", "Plains Workshop", "PLANT", "11 Depot St", "Emerald", "4720"),
    ("n11", "Kestrel Ridge Contracting", "51 000 000 111", "APPROVED", "Construction", "Kestrel Site Office", "OFFICE", "1 Ridge Rd", "Kestrel", "4715"),
    ("n12", "Tropic Line Electrical", "", "NEW", "Energy", "Tropic Line Depot", "DEPOT", "9 Cable St", "Townsville", "4810"),
    ("n13", "Wandoo Valve & Controls", "51 000 000 133", "NEW", "Manufacturing", "Wandoo Factory", "PLANT", "60 Valve Ave", "Brisbane", "4000"),
    ("n14", "Gladstone Bulk Services", "51 000 000 144", "NEW", "Transport", "Bulk Terminal", "PLANT", "Port Access Rd", "Gladstone", "4680"),
    ("n15", "Barcaldine Rail Maintenance", "", "STALE", "Transport", "Rail Yard", "DEPOT", "Station St", "Barcaldine", "4725"),
]

# (company id, name, position, priority, email, mobile)
CONTACTS = [
    ("n1", "Alex Morgan", "Plant Manager", "PRIORITY", "amorgan@example.test", "0400 100 001"),
    ("n1", "Sam Ellery", "Maintenance Manager", "PRIORITY", "sellery@example.test", ""),
    ("n1", "Jordan Pike", "Purchasing Manager", "PRIORITY", "jpike@example.test", "0400 100 003"),
    ("n1", "Riley Chen", "Environmental Manager", "SECONDARY", "rchen@example.test", ""),
    ("n1", "Casey Doyle", "Technical Services Manager", "OTHER", "cdoyle@example.test", ""),
    ("n2", "Taylor Brooks", "Operations Manager", "PRIORITY", "tbrooks@example.test", "0400 100 006"),
    ("n3", "Morgan Reid", "General Manager", "PRIORITY", "mreid@example.test", "0400 100 007"),
    ("n4", "Jamie Fox", "Fleet Manager", "SECONDARY", "jfox@example.test", ""),
    ("n5", "Drew Harper", "Site Manager", "PRIORITY", "dharper@example.test", "0400 100 009"),
    ("n5", "Quinn Ashby", "Safety Manager", "SECONDARY", "qashby@example.test", ""),
    ("n7", "Robin Vale", "Owner", "PRIORITY", "rvale@example.test", "0400 100 011"),
    ("n8", "Avery Stone", "Logistics Manager", "SECONDARY", "astone@example.test", ""),
    ("n9", "Blake Warren", "Mine Manager", "PRIORITY", "bwarren@example.test", "0400 100 013"),
    ("n11", "Skyler Nash", "Project Manager", "SECONDARY", "snash@example.test", ""),
    ("n13", "Reese Holt", "Procurement Manager", "PRIORITY", "rholt@example.test", "0400 100 015"),
    ("n14", "Peyton Marsh", "Operations Manager", "PRIORITY", "pmarsh@example.test", "0400 100 016"),
]


def seed() -> None:
    for cid, name, abn, status, industry, site, typ, addr, suburb, pc in COMPANIES:
        sheets_adapter._companies[cid] = {
            "company_id": cid, "abn": abn, "company_name": name,
            "normalized_name": name.lower(), "trading_name": "", "website": "",
            "industry": industry, "abn_status": "", "status": status,
            "industry_fit": "TARGET", "priority": "", "source": "LEGACY_EXCEL",
            "last_verified": "", "last_modified": NOW, "notes": None,
        }
        sheets_adapter._locations["l_" + cid] = {
            "location_id": "l_" + cid, "company_id": cid, "site_name": site,
            "location_type": typ, "address": addr, "suburb": suburb, "state": "QLD",
            "postcode": pc, "lat": "", "lng": "", "verification_status": "UNVERIFIED",
            "last_verified": "", "last_modified": NOW,
        }
    for i, (cid, name, pos, prio, email, mobile) in enumerate(CONTACTS):
        sheets_adapter._contacts[f"k{i}"] = {
            "contact_id": f"k{i}", "company_id": cid, "location_id": "l_" + cid,
            "name": name, "position": pos, "role_bucket": pos, "role_priority": prio,
            "business_email": email, "mobile": mobile, "landline": "",
            "professional_url": "", "contact_status": "NEW",
            "last_verified": "", "last_modified": NOW,
        }
    sheets_adapter._rejections.extend([
        {"entity_id": "n99", "entity_type": "company", "entity_name": "Example Head Office Pty Ltd",
         "reason": "Head office only - no operating site in Queensland", "rejected_by": "user",
         "rejected_at": NOW, "original_data": "{}"},
        {"entity_id": "l98", "entity_type": "location", "entity_name": "Old Depot (closed)",
         "reason": "Site has closed", "rejected_by": "user", "rejected_at": NOW, "original_data": "{}"},
    ])


# Make the sidebar show the green "Synced" state, as the real deployment does.
_orig_status = sheets_adapter.get_sync_status


async def _live_looking_status():
    status = await _orig_status()
    status["mode"] = "live"
    return status


sheets_adapter.get_sync_status = _live_looking_status  # type: ignore[method-assign]

if __name__ == "__main__":
    seed()
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="warning")
