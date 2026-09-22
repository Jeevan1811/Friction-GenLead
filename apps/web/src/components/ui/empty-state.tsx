"use client";

import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={clsx(className)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        textAlign: "center",
        gap: "12px",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "var(--radius-lg)",
          background: "var(--color-accent-light)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "4px",
        }}
      >
        <Icon size={24} color="var(--color-accent)" strokeWidth={1.5} />
      </div>

      <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text)" }}>
        {title}
      </h3>

      {description && (
        <p
          style={{
            fontSize: "13px",
            color: "var(--color-text-muted)",
            maxWidth: "320px",
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}

      {action && (
        <button
          className="btn-primary"
          onClick={action.onClick}
          style={{ marginTop: "8px" }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
