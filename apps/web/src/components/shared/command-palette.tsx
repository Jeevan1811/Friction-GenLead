"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Building2,
  MapPin,
  Users,
  History,
  XCircle,
  ArrowRight,
  Plus,
  FileSearch,
} from "lucide-react";

interface CommandItem {
  id: string;
  label: string;
  group: string;
  icon: React.ReactNode;
  action: () => void;
  keywords?: string[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const commands: CommandItem[] = [
    {
      id: "nav-search",
      label: "Search Prospects",
      group: "Navigation",
      icon: <Search size={16} />,
      action: () => { router.push("/search"); onClose(); },
      keywords: ["find", "prospect", "postcode"],
    },
    {
      id: "nav-companies",
      label: "Companies",
      group: "Navigation",
      icon: <Building2 size={16} />,
      action: () => { router.push("/companies"); onClose(); },
      keywords: ["business", "firm"],
    },
    {
      id: "nav-locations",
      label: "Locations",
      group: "Navigation",
      icon: <MapPin size={16} />,
      action: () => { router.push("/locations"); onClose(); },
      keywords: ["site", "plant", "mine", "office"],
    },
    {
      id: "nav-contacts",
      label: "Contacts",
      group: "Navigation",
      icon: <Users size={16} />,
      action: () => { router.push("/contacts"); onClose(); },
      keywords: ["people", "person", "email"],
    },
    {
      id: "nav-source-data",
      label: "Original Source Data",
      group: "Navigation",
      icon: <FileSearch size={16} />,
      action: () => { router.push("/source-data"); onClose(); },
      keywords: ["excel", "workbook", "import", "raw", "source", "landline", "postcode"],
    },
    {
      id: "nav-searches",
      label: "Search History",
      group: "Navigation",
      icon: <History size={16} />,
      action: () => { router.push("/searches"); onClose(); },
      keywords: ["past", "history", "runs"],
    },
    {
      id: "nav-rejected",
      label: "Rejected",
      group: "Navigation",
      icon: <XCircle size={16} />,
      action: () => { router.push("/rejected"); onClose(); },
      keywords: ["declined", "removed"],
    },
    {
      id: "act-new-search",
      label: "New Search",
      group: "Actions",
      icon: <Plus size={16} />,
      action: () => { router.push("/search"); onClose(); },
      keywords: ["start", "create", "begin"],
    },
    {
      id: "act-review-queue",
      label: "Review Queue",
      group: "Actions",
      icon: <ArrowRight size={16} />,
      action: () => { router.push("/companies?tab=review"); onClose(); },
      keywords: ["pending", "approve"],
    },
  ];

  const filtered = commands.filter((cmd) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(q) ||
      cmd.group.toLowerCase().includes(q) ||
      cmd.keywords?.some((k) => k.includes(q))
    );
  });

  const groups = Array.from(new Set(filtered.map((c) => c.group)));

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[activeIndex]) {
        filtered[activeIndex].action();
      }
    },
    [onClose, filtered, activeIndex]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.4)",
          zIndex: 60,
          animation: "fadeIn 120ms ease-out",
        }}
      />

      {/* Palette */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          position: "fixed",
          top: "min(20%, 120px)",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(560px, calc(100vw - 32px))",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 70,
          overflow: "hidden",
          animation: "scaleIn 160ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <Search size={18} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: "14px",
              color: "var(--color-text)",
              fontFamily: "var(--font-sans)",
              height: "32px",
              minHeight: "32px",
              minWidth: 0,
            }}
          />
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{
            maxHeight: "320px",
            overflowY: "auto",
            padding: "8px",
          }}
        >
          {filtered.length === 0 && (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                color: "var(--color-text-muted)",
                fontSize: "13px",
              }}
            >
              No results found
            </div>
          )}
          {groups.map((group) => (
            <div key={group}>
              <div
                style={{
                  padding: "8px 12px 4px",
                  fontSize: "11px",
                  fontWeight: 500,
                  color: "var(--color-text-muted)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {group}
              </div>
              {filtered
                .filter((c) => c.group === group)
                .map((cmd) => {
                  flatIndex++;
                  const isActive = flatIndex === activeIndex;
                  const idx = flatIndex;
                  return (
                    <button
                      key={cmd.id}
                      onClick={cmd.action}
                      onMouseEnter={() => setActiveIndex(idx)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        width: "100%",
                        padding: "10px 12px",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        background: isActive
                          ? "var(--color-accent-light)"
                          : "transparent",
                        color: isActive
                          ? "var(--color-accent)"
                          : "var(--color-text)",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontFamily: "var(--font-sans)",
                        textAlign: "left",
                        transition: "background var(--transition-fast)",
                        minHeight: "40px",
                        minWidth: "auto",
                      }}
                    >
                      <span
                        style={{
                          color: isActive
                            ? "var(--color-accent)"
                            : "var(--color-text-muted)",
                          flexShrink: 0,
                        }}
                      >
                        {cmd.icon}
                      </span>
                      {cmd.label}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            padding: "8px 16px",
            borderTop: "1px solid var(--color-border)",
            fontSize: "11px",
            color: "var(--color-text-muted)",
          }}
        >
          <span>
            <kbd style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid var(--color-border)", fontSize: "10px", fontFamily: "var(--font-sans)" }}>↑↓</kbd> navigate
          </span>
          <span>
            <kbd style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid var(--color-border)", fontSize: "10px", fontFamily: "var(--font-sans)" }}>↵</kbd> select
          </span>
          <span>
            <kbd style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid var(--color-border)", fontSize: "10px", fontFamily: "var(--font-sans)" }}>esc</kbd> close
          </span>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: translateX(-50%) scale(0.96); }
          to { opacity: 1; transform: translateX(-50%) scale(1); }
        }
      `}</style>
    </>
  );
}
