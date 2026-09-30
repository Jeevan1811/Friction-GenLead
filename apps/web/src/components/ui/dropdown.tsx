"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useAnchoredPanel } from "./use-anchored-panel";

/* ---------- Types ---------- */
export type DropdownItem =
  | { kind?: "item"; label: string; icon?: LucideIcon; onClick: () => void; destructive?: boolean }
  | { kind: "separator" };

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  className?: string;
}

/* ---------- Component ---------- */
export function Dropdown({ trigger, items, className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const placement = useAnchoredPanel(open, triggerRef, menuRef, 280);

  /* Click-outside to close */
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  /* Reset focus when closing */
  useEffect(() => {
    if (!open) setFocusIdx(-1);
  }, [open]);

  /* Actionable items (exclude separators) for keyboard nav */
  const actionableIndices = items
    .map((it, i) => ((!("kind" in it) || it.kind === "item") ? i : -1))
    .filter((i) => i >= 0);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen(true);
          setFocusIdx((e.key === "ArrowUp" ? actionableIndices.at(-1) : actionableIndices[0]) ?? -1);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (e.key === "Tab") { setOpen(false); return; }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        setFocusIdx((e.key === "Home" ? actionableIndices[0] : actionableIndices.at(-1)) ?? -1);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const curPos = actionableIndices.indexOf(focusIdx);
        const next = actionableIndices[(curPos + 1) % actionableIndices.length];
        setFocusIdx(next);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        const curPos = actionableIndices.indexOf(focusIdx);
        const prev = actionableIndices[(curPos - 1 + actionableIndices.length) % actionableIndices.length];
        setFocusIdx(prev);
        return;
      }

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const item = items[focusIdx];
        if (item && (!("kind" in item) || item.kind === "item")) {
          item.onClick();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    },
    [open, focusIdx, actionableIndices, items]
  );

  /* Focus the active item */
  useEffect(() => {
    if (open && focusIdx >= 0 && menuRef.current) {
      const el = menuRef.current.children[focusIdx] as HTMLElement | undefined;
      el?.focus();
    }
  }, [open, focusIdx]);

  return (
    <div
      ref={containerRef}
      className={clsx(className)}
      style={{ position: "relative", display: "inline-flex" }}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen(o => !o); setFocusIdx(actionableIndices[0] ?? -1); }}
        className="dropdown-trigger"
        aria-label="Open user menu"
        style={{
          width: 44,
          height: 44,
          minWidth: 44,
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          border: 0,
          background: "transparent",
          color: "inherit",
          font: "inherit",
          lineHeight: 0,
          cursor: "pointer",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
      >
        {trigger}
      </button>

      {/* Menu */}
      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          style={{
            ...placement,
            overflowY: "auto",
            overflowWrap: "anywhere",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)",
            padding: "4px",
            zIndex: 100,
            animation: "dropdown-fade-in 120ms ease-out",
          }}
        >
          {items.map((item, idx) => {
            if ("kind" in item && item.kind === "separator") {
              return (
                <div
                  key={`sep-${idx}`}
                  role="separator"
                  style={{
                    height: "1px",
                    background: "var(--color-border-subtle)",
                    margin: "4px 8px",
                  }}
                />
              );
            }

            const actionItem = item as Extract<DropdownItem, { label: string }>;
            const IconComp = actionItem.icon;

            return (
              <button
                key={idx}
                role="menuitem"
                tabIndex={-1}
                className="dropdown-item"
                onClick={() => {
                  actionItem.onClick();
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: "13px",
                  fontWeight: 400,
                  color: actionItem.destructive ? "var(--color-error)" : "var(--color-text)",
                  background: focusIdx === idx ? "var(--color-accent-light)" : "transparent",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background var(--transition-fast)",
                  minHeight: "44px",
                  minWidth: "auto",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {IconComp && <IconComp size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />}
                <span style={{ minWidth: 0 }}>{actionItem.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---- Inject styles ---- */
if (typeof document !== "undefined") {
  const STYLE_ID = "dropdown-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes dropdown-fade-in {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .dropdown-item:hover {
        background: var(--color-accent-light) !important;
      }
      .dropdown-item:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: -2px;
      }
      .dropdown-trigger:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
        border-radius: var(--radius-sm);
      }
    `;
    document.head.appendChild(style);
  }
}
