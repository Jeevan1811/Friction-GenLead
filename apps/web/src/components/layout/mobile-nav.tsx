"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  Building2,
  Users,
  History,
  MoreHorizontal,
  FileSearch,
  FileSpreadsheet,
  MapPin,
  CalendarClock,
  XCircle,
} from "lucide-react";
import { getSyncStatus } from "@/lib/api";
import { buildGoogleSheetUrl } from "@/lib/google-sheets-link.mjs";

const mobileNavItems = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/searches", label: "Searches", icon: History },
  { href: "/source-data", label: "Source", icon: FileSearch },
];

const moreItems = [
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { href: "/rejected", label: "Rejected", icon: XCircle },
];

const morePaths = moreItems.map((item) => item.href);

export function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const googleSheetUrl = buildGoogleSheetUrl(spreadsheetId);
  const moreActive = morePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  useEffect(() => {
    let current = true;
    getSyncStatus()
      .then((status) => {
        if (current) setSpreadsheetId(status.spreadsheetId);
      })
      .catch(() => {
        if (current) setSpreadsheetId(null);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !moreButtonRef.current?.contains(target)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [moreOpen]);

  return (
    <>
      <nav
        aria-label="Main navigation"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "var(--mobile-nav-height)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          background: "var(--color-surface)",
          borderTop: "1px solid var(--color-border)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          zIndex: 30,
        }}
      >
        {mobileNavItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                flex: "1 1 0",
                minWidth: 0,
                padding: "6px 3px",
                minHeight: "44px",
                justifyContent: "center",
                textDecoration: "none",
                color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                transition: "color var(--transition-fast)",
              }}
            >
              <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
              <span style={{ fontSize: "9px", fontWeight: isActive ? 600 : 400, lineHeight: 1 }}>
                {item.label}
              </span>
            </Link>
          );
        })}
        <button
          ref={moreButtonRef}
          type="button"
          aria-label={moreOpen ? "Close more navigation" : "More navigation"}
          aria-expanded={moreOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMoreOpen((value) => !value)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            flex: "1 1 0",
            minWidth: 0,
            minHeight: "44px",
            padding: "6px 3px",
            border: 0,
            background: "transparent",
            color: moreActive || moreOpen ? "var(--color-accent)" : "var(--color-text-muted)",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          <MoreHorizontal size={20} strokeWidth={moreActive || moreOpen ? 2.2 : 1.8} aria-hidden="true" />
          <span style={{ fontSize: "9px", fontWeight: moreActive || moreOpen ? 600 : 400, lineHeight: 1 }}>
            More
          </span>
        </button>
      </nav>

      <div
        ref={menuRef}
        id="mobile-more-menu"
        hidden={!moreOpen}
        style={{
          position: "fixed",
          right: "8px",
          bottom: "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px) + 8px)",
          width: "min(240px, calc(100vw - 16px))",
          padding: "6px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 8px 28px rgba(0, 0, 0, 0.14)",
          zIndex: 31,
        }}
      >
        <nav aria-label="More navigation">
          {moreItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                style={moreLinkStyle}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          {googleSheetUrl && (
            <a
              href={googleSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the live Google Sheet"
              onClick={() => setMoreOpen(false)}
              style={moreLinkStyle}
            >
              <FileSpreadsheet size={18} aria-hidden="true" />
              <span>Google Sheet</span>
            </a>
          )}
        </nav>
      </div>
    </>
  );
}

const moreLinkStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  minHeight: "44px",
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text-secondary)",
  fontSize: "13px",
  textDecoration: "none",
};
