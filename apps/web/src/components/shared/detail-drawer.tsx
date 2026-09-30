"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function DetailDrawer({ open, onClose, title, children }: DetailDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      const drawer = drawerRef.current;
      if (!drawer) return;
      // A second dialog (e.g. rejection confirmation) owns its own keyboard flow.
      const activeDialog = document.activeElement?.closest('[aria-modal="true"]:is([role="dialog"], [role="alertdialog"])');
      if (activeDialog && activeDialog !== drawer) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== "Tab") return;
      const controls = [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')]
        .filter(el => el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgb(8 15 26 / 50%)",
          zIndex: 9993,
          animation: "fadeIn 160ms ease-out",
        }}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="genlead-detail-drawer"
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
          zIndex: 9994,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "slideInRight 220ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "16px 24px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <h2 style={{ minWidth: 0, overflowWrap: "anywhere", fontSize: "17px", fontWeight: 600, lineHeight: 1.4 }}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              minHeight: 44,
              minWidth: 44,
              flexShrink: 0,
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
          className="genlead-detail-content"
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflowY: "auto",
            overflowWrap: "anywhere",
            overscrollBehavior: "contain",
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
    </>, document.body
  );
}
