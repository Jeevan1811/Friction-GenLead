"use client";

import { useState } from "react";
import {
  Search,
  ChevronDown,
  Zap,
  Clock,
  Building2,
  Users,
  Check,
  Loader2,
} from "lucide-react";
import { searchRuns } from "@/lib/fixtures";
import { StatusBadge } from "@/components/shared/status-badge";
import { ResearchProgress } from "@/components/shared/research-progress";
import { useToast } from "@/components/ui/toast";
import { startResearch } from "@/lib/api";

const INDUSTRIES = [
  "Mining",
  "Energy",
  "Heavy Industry",
  "Construction",
  "Transport",
  "Manufacturing",
];

const PRIORITY_ROLES = [
  "Owner",
  "Managing Director",
  "General Manager",
  "Plant Manager",
  "Operations Manager",
  "Maintenance Manager",
  "Engineering Manager",
  "Procurement Manager",
  "Purchasing Manager",
  "Commercial Director",
  "Site Manager",
  "Mine Manager",
];

const SECONDARY_ROLES = [
  "Safety Manager",
  "Environmental Manager",
  "Project Manager",
  "Workshop Manager",
  "Fleet Manager",
  "Supply Chain Manager",
  "Logistics Manager",
  "Technical Manager",
  "Quality Manager",
  "HR Manager",
];

export default function SearchPage() {
  const [postcode, setPostcode] = useState("");
  const [industry, setIndustry] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [postcodeError, setPostcodeError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [researchPostcode, setResearchPostcode] = useState("");
  const { toast } = useToast();

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const validatePostcode = (value: string) => {
    if (!value) {
      setPostcodeError("");
      return;
    }
    if (!/^\d{4}$/.test(value)) {
      setPostcodeError("Enter a valid 4-digit postcode");
      return;
    }
    const num = parseInt(value, 10);
    if (num < 4000 || num > 4999) {
      setPostcodeError("Enter a Queensland postcode (4000-4999)");
      return;
    }
    setPostcodeError("");
  };

  const canSubmit =
    postcode.length === 4 &&
    !postcodeError &&
    selectedRoles.length > 0;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "800px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Search Prospects
        </h1>
        <p
          style={{
            fontSize: "13px",
            color: "var(--color-text-secondary)",
            marginTop: "4px",
          }}
        >
          Discover and verify industrial companies and contacts in Queensland
        </p>
      </div>

      {/* Search form */}
      <div
        className="surface-card"
        style={{ padding: "24px", marginBottom: "32px" }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          {/* Postcode */}
          <div>
            <label
              htmlFor="postcode"
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--color-text-muted)",
                marginBottom: "6px",
              }}
            >
              Postcode
            </label>
            <input
              id="postcode"
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="e.g. 4680"
              value={postcode}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                setPostcode(v);
                validatePostcode(v);
              }}
              className="input-field"
              style={{
                borderColor: postcodeError
                  ? "var(--color-error)"
                  : undefined,
              }}
            />
            {postcodeError && (
              <p
                style={{
                  fontSize: "11px",
                  color: "var(--color-error)",
                  marginTop: "4px",
                }}
              >
                {postcodeError}
              </p>
            )}
          </div>

          {/* Industry */}
          <div>
            <label
              htmlFor="industry"
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--color-text-muted)",
                marginBottom: "6px",
              }}
            >
              Industry
            </label>
            <div style={{ position: "relative" }}>
              <select
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="input-field"
                style={{
                  appearance: "none",
                  paddingRight: "36px",
                  cursor: "pointer",
                }}
              >
                <option value="">All industries</option>
                {INDUSTRIES.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-text-muted)",
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>
        </div>

        {/* Role selection */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--color-text-muted)",
              marginBottom: "10px",
            }}
          >
            Target Roles
          </label>

          {/* Priority Roles */}
          <div style={{ marginBottom: "12px" }}>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: "8px",
              }}
            >
              Priority
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
              }}
            >
              {PRIORITY_ROLES.map((role) => {
                const selected = selectedRoles.includes(role);
                return (
                  <button
                    key={role}
                    onClick={() => toggleRole(role)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 400,
                      fontFamily: "var(--font-sans)",
                      borderRadius: "var(--radius-pill)",
                      border: `1px solid ${
                        selected
                          ? "var(--color-accent)"
                          : "var(--color-border)"
                      }`,
                      background: selected
                        ? "var(--color-accent-light)"
                        : "transparent",
                      color: selected
                        ? "var(--color-accent)"
                        : "var(--color-text-secondary)",
                      cursor: "pointer",
                      transition: "all var(--transition-fast)",
                      minHeight: "32px",
                      minWidth: "auto",
                    }}
                  >
                    {selected && <Check size={12} />}
                    {role}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Secondary Roles */}
          <div>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: "8px",
              }}
            >
              Secondary
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
              }}
            >
              {SECONDARY_ROLES.map((role) => {
                const selected = selectedRoles.includes(role);
                return (
                  <button
                    key={role}
                    onClick={() => toggleRole(role)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 400,
                      fontFamily: "var(--font-sans)",
                      borderRadius: "var(--radius-pill)",
                      border: `1px solid ${
                        selected
                          ? "var(--color-accent)"
                          : "var(--color-border)"
                      }`,
                      background: selected
                        ? "var(--color-accent-light)"
                        : "transparent",
                      color: selected
                        ? "var(--color-accent)"
                        : "var(--color-text-secondary)",
                      cursor: "pointer",
                      transition: "all var(--transition-fast)",
                      minHeight: "32px",
                      minWidth: "auto",
                    }}
                  >
                    {selected && <Check size={12} />}
                    {role}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Submit */}
        <button
          disabled={!canSubmit || submitting}
          className="btn-primary"
          style={{ width: "100%" }}
          onClick={async () => {
            if (!canSubmit || submitting) return;
            setSubmitting(true);
            try {
              const res = await startResearch(
                postcode,
                industry || undefined,
                selectedRoles
              );
              toast(`Research started for postcode ${postcode}`, "success");
              setResearchPostcode(postcode);
              setActiveJobId(res.job_id);
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "Failed to start research";
              toast(msg, "error");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? (
            <Loader2
              size={16}
              style={{ animation: "spin 1s linear infinite" }}
            />
          ) : (
            <Zap size={16} />
          )}
          {submitting ? "Starting..." : "Start Research"}
        </button>
        {!canSubmit && postcode.length > 0 && selectedRoles.length === 0 && (
          <p
            style={{
              fontSize: "11px",
              color: "var(--color-text-muted)",
              marginTop: "8px",
              textAlign: "center",
            }}
          >
            Select at least one target role to begin
          </p>
        )}
      </div>

      {/* Active research progress */}
      {activeJobId && (
        <ResearchProgress
          jobId={activeJobId}
          onComplete={(data) => {
            toast(
              `Research complete: ${data.companies_found} companies, ${data.contacts_found} contacts found`,
              "success"
            );
          }}
        />
      )}

      {/* Recent searches */}
      <div>
        <h3
          style={{
            fontSize: "13px",
            fontWeight: 600,
            marginBottom: "12px",
            color: "var(--color-text)",
          }}
        >
          Recent Searches
        </h3>

        {searchRuns.length === 0 ? (
          <div
            className="surface-card"
            style={{
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <Clock
              size={32}
              style={{
                color: "var(--color-text-muted)",
                marginBottom: "12px",
              }}
            />
            <p
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted)",
              }}
            >
              No searches yet. Start your first one above.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "8px",
            }}
          >
            {searchRuns.map((run) => (
              <div
                key={run.searchId}
                className="surface-card"
                style={{
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  cursor: "pointer",
                  transition: "all var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-accent)";
                  e.currentTarget.style.background =
                    "var(--color-accent-light)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.background = "var(--color-surface)";
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontWeight: 600,
                    fontSize: "13px",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {run.postcode}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "2px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "var(--color-text)",
                      }}
                    >
                      Postcode {run.postcode}
                    </span>
                    {run.industry && (
                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {run.industry}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {formatDate(run.startedAt)}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "12px",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <Building2 size={14} />
                    {run.companiesFound}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "12px",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <Users size={14} />
                    {run.contactsFound}
                  </div>
                  <StatusBadge
                    status={run.status === "running" ? "VERIFYING" : run.status === "completed" ? "APPROVED" : run.status === "failed" ? "ERROR" : "STALE"}
                    showDot
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
