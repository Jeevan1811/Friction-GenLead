"use client";

import { useEffect, useRef, useCallback } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  /* Focus trap: cycle between cancel and confirm */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === "Enter") {
        /* Enter confirms only if focus is NOT on cancel */
        if (document.activeElement !== cancelBtnRef.current) {
          e.preventDefault();
          onConfirm();
        }
        return;
      }

      if (e.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [open, onCancel, onConfirm]
  );

  useEffect(() => {
    if (open) {
      cancelBtnRef.current?.focus();
      document.addEventListener("keydown", handleKeyDown);
      /* Prevent body scroll */
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = prev;
      };
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.4)",
          animation: "confirm-fade-in 160ms ease-out",
        }}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={description ? "confirm-desc" : undefined}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "400px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-lg)",
          padding: "24px",
          animation: "confirm-scale-in 220ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <h3
          id="confirm-title"
          style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text)", marginBottom: "8px" }}
        >
          {title}
        </h3>

        {description && (
          <p
            id="confirm-desc"
            style={{
              fontSize: "13px",
              color: "var(--color-text-secondary)",
              lineHeight: 1.5,
              marginBottom: "20px",
            }}
          >
            {description}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            ref={cancelBtnRef}
            className="btn-secondary"
            onClick={onCancel}
            style={{ height: "40px", padding: "0 16px" }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "40px",
              padding: "0 16px",
              fontSize: "13px",
              fontWeight: 500,
              color: "#FFFFFF",
              background: destructive ? "var(--color-error)" : "var(--color-accent)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              transition: "opacity var(--transition-fast)",
              whiteSpace: "nowrap",
              minWidth: "44px",
              minHeight: "40px",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.9"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Inject keyframes ---- */
if (typeof document !== "undefined") {
  const STYLE_ID = "confirm-dialog-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes confirm-fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes confirm-scale-in {
        from { opacity: 0; transform: scale(0.95); }
        to   { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }
}
