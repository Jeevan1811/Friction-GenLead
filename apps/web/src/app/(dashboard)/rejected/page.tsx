"use client";

import { useEffect, useState } from "react";
import { XCircle, RotateCcw, Building2, MapPin, Users } from "lucide-react";
import { getRejected } from "@/lib/api";
import type { RejectedEntity } from "@/lib/types";
import { PageLoading, PageError } from "@/components/shared/page-status";

const entityTypeIcons: Record<string, typeof Building2> = {
  company: Building2,
  location: MapPin,
  contact: Users,
};

const entityTypeLabels: Record<string, string> = {
  company: "Companies",
  location: "Locations",
  contact: "Contacts",
};

export default function RejectedPage() {
  const [rejectedEntities, setRejectedEntities] = useState<RejectedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getRejected();
        if (!cancelled) setRejectedEntities(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load rejected entities");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const groupedByType = rejectedEntities.reduce(
    (acc, entity) => {
      if (!acc[entity.entityType]) acc[entity.entityType] = [];
      acc[entity.entityType].push(entity);
      return acc;
    },
    {} as Record<string, typeof rejectedEntities>
  );

  const typeOrder = ["company", "location", "contact"];
  const orderedGroups = typeOrder.filter((t) => groupedByType[t]?.length);

  return (
    <div style={{ padding: "24px", maxWidth: "800px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Rejected
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
          Entities you have rejected during review
        </p>
      </div>

      {error && (
        <div style={{ marginBottom: "16px" }}>
          <PageError message={error} />
        </div>
      )}

      {loading ? (
        <PageLoading label="Loading rejected entities..." />
      ) : orderedGroups.length === 0 ? (
        <div
          className="surface-card"
          style={{
            padding: "64px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <XCircle size={36} style={{ color: "var(--color-text-muted)" }} />
          <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-secondary)" }}>
            No rejected entities
          </p>
          <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
            Entities you reject during review will appear here
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {orderedGroups.map((type) => {
            const entities = groupedByType[type];
            const Icon = entityTypeIcons[type] ?? Building2;
            const label = entityTypeLabels[type] ?? type;

            return (
              <div key={type}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "12px",
                  }}
                >
                  <Icon size={16} style={{ color: "var(--color-text-muted)" }} />
                  <h3 style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)" }}>
                    {label}
                  </h3>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 500,
                      padding: "1px 8px",
                      borderRadius: "var(--radius-pill)",
                      background: "var(--color-border-subtle)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {entities.length}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {entities.map((entity) => (
                    <div
                      key={entity.entityId}
                      className="surface-card"
                      style={{
                        padding: "16px 20px",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "16px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "var(--color-text)",
                            marginBottom: "4px",
                          }}
                        >
                          {entity.entityName}
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "var(--color-text-secondary)",
                            marginBottom: "6px",
                            lineHeight: 1.5,
                          }}
                        >
                          {entity.reason}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                          Rejected by {entity.rejectedBy} on {formatDate(entity.rejectedAt)}
                        </div>
                      </div>
                      <button
                        className="btn-secondary"
                        style={{
                          height: "36px",
                          padding: "0 14px",
                          fontSize: "12px",
                          gap: "6px",
                          flexShrink: 0,
                        }}
                      >
                        <RotateCcw size={14} />
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
