"use client";

import { usePathname } from "next/navigation";
import { Search, Bell } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/search": "Search Prospects",
  "/companies": "Companies",
  "/locations": "Locations",
  "/contacts": "Contacts",
  "/searches": "Search History",
  "/rejected": "Rejected",
};

interface HeaderProps {
  onOpenCommandPalette: () => void;
}

export function Header({ onOpenCommandPalette }: HeaderProps) {
  const pathname = usePathname();
  const title = pageTitles[pathname] ?? "Friction GenLead";

  return (
    <header
      style={{
        height: "var(--header-height)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
        gap: "16px",
      }}
    >
      {/* Page title */}
      <h2
        style={{
          fontSize: "15px",
          fontWeight: 600,
          color: "var(--color-text)",
          whiteSpace: "nowrap",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>

      {/* Search bar */}
      <button
        onClick={onOpenCommandPalette}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flex: "0 1 400px",
          height: "36px",
          minHeight: "36px",
          padding: "0 12px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg)",
          color: "var(--color-text-muted)",
          cursor: "pointer",
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
          transition: "border-color var(--transition-fast)",
          minWidth: 0,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-accent)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-border)")
        }
      >
        <Search size={14} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: "left" }}>Search...</span>
        <kbd
          style={{
            fontSize: "11px",
            padding: "2px 6px",
            borderRadius: 4,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-sans)",
            lineHeight: "16px",
          }}
        >
          {"⌘"}K
        </kbd>
      </button>

      {/* Right actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {/* Notification bell */}
        <button
          aria-label="Notifications"
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
            position: "relative",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--color-accent-light)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <Bell size={18} />
          {/* Notification dot */}
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--color-accent)",
              border: "2px solid var(--color-surface)",
            }}
          />
        </button>

        {/* User avatar */}
        <button
          aria-label="User menu"
          style={{
            width: 32,
            height: 32,
            minHeight: 32,
            minWidth: 32,
            borderRadius: "50%",
            border: "2px solid var(--color-border)",
            background: "var(--color-accent-light)",
            color: "var(--color-accent)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            fontWeight: 600,
            fontFamily: "var(--font-sans)",
            transition: "border-color var(--transition-fast)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderColor = "var(--color-accent)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderColor = "var(--color-border)")
          }
        >
          JK
        </button>
      </div>
    </header>
  );
}
