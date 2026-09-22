"use client";

import { useEffect, useCallback } from "react";
import { X } from "lucide-react";

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function DetailDrawer({ open, onClose, title, children }: DetailDrawerProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.3)",
          zIndex: 40,
          animation: "fadeIn 160ms ease-out",
        }}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(480px, 100vw)",
          background: "var(--color-surface)",
          borderLeft: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-drawer)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          animation: "slideInRight 220ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <h2 style={{ fontSize: "15px", fontWeight: 600 }}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              minHeight: 36,
              minWidth: 36,
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: "transparent",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              transition: "background var(--transition-fast)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--color-accent-light)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
          }}
        >
          {children}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
