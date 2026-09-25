"""Domain enums mirroring packages/contracts/src/enums.ts."""

from enum import StrEnum


class CompanyStatus(StrEnum):
    NEW = "NEW"
    VERIFYING = "VERIFYING"
    REVIEW = "REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    STALE = "STALE"
    INACTIVE = "INACTIVE"
    ERROR = "ERROR"


class LocationStatus(StrEnum):
    UNVERIFIED = "UNVERIFIED"
    VERIFYING = "VERIFYING"
    APPROVED = "APPROVED"
    VERIFIED = "VERIFIED"
    CLOSED = "CLOSED"
    DISPUTED = "DISPUTED"


class ContactStatus(StrEnum):
    NEW = "NEW"
    VERIFIED = "VERIFIED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    STALE = "STALE"
    LEFT_COMPANY = "LEFT_COMPANY"


class EvidenceSource(StrEnum):
    ABR = "ABR"
    QLD_PLS = "QLD_PLS"
    AUSPOST = "AUSPOST"
    OFFICIAL_WEBSITE = "OFFICIAL_WEBSITE"
    PUBLIC_SEARCH = "PUBLIC_SEARCH"
    LEGACY_EXCEL = "LEGACY_EXCEL"
    PROJECT_REPORT = "PROJECT_REPORT"
    USER = "USER"


class ReliabilityTier(StrEnum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    E = "E"


class RolePriority(StrEnum):
    PRIORITY = "PRIORITY"
    SECONDARY = "SECONDARY"
    OTHER = "OTHER"


class LocationType(StrEnum):
    PLANT = "PLANT"
    MINE = "MINE"
    OFFICE = "OFFICE"
    PROJECT = "PROJECT"
    DEPOT = "DEPOT"
    OTHER = "OTHER"


class SyncState(StrEnum):
    SYNCED = "SYNCED"
    PENDING = "PENDING"
    ERROR = "ERROR"
    NEVER = "NEVER"


class IndustryFit(StrEnum):
    TARGET = "TARGET"
    ADJACENT = "ADJACENT"
    UNLIKELY = "UNLIKELY"
    EXCLUDED = "EXCLUDED"


class SiteEvidence(StrEnum):
    CONFIRMED = "CONFIRMED"
    LIKELY = "LIKELY"
    UNCERTAIN = "UNCERTAIN"
    DISPROVEN = "DISPROVEN"


class EntityMatch(StrEnum):
    EXACT = "EXACT"
    PARTIAL = "PARTIAL"
    NONE = "NONE"
