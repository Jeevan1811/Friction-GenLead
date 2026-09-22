"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  Search,
  Building2,
  MapPin,
  Users,
  History,
  XCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { SyncIndicator } from "@/components/shared/sync-indicator";
import { syncStatus, companies, locations, contacts, searchRuns, rejectedEntities } from "@/lib/fixtures";

const navItems = [
  {
    href: "/search",
    label: "Search",
    icon: Search,
    count: null,
  },
  {
    href: "/companies",
    label: "Companies",
    icon: Building2,
    countFn: () => companies.filter((c) => c.status !== "REJECTED").length,
  },
  {
    href: "/locations",
    label: "Locations",
    icon: MapPin,
    countFn: () => locations.length,
  },
  {
    href: "/contacts",
    label: "Contacts",
    icon: Users,
    countFn: () => contacts.length,
  },
  {
    href: "/searches",
    label: "Searches",
    icon: History,
    countFn: () => searchRuns.length,
  },
  {
    href: "/rejected",
    label: "Rejected",
    icon: XCircle,
    countFn: () => rejectedEntities.length,
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)",
        height: "100dvh",
        position: "fixed",
        top: 0,
        left: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface)",
        borderRight: "1px solid var(--color-border)",
        transition: "width var(--transition-normal)",
        zIndex: 30,
        overflow: "hidden",
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: collapsed ? "20px 0" : "20px 20px",
          justifyContent: collapsed ? "center" : "flex-start",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "var(--radius-sm)",
            background: "var(--color-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: "#fff",
              fontWeight: 700,
              fontSize: "14px",
              lineHeight: 1,
            }}
          >
            G
          </span>
        </div>
        {!collapsed && (
          <span
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "var(--color-text)",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            Gen<span style={{ color: "var(--color-accent)" }}>Lead</span>
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          padding: collapsed ? "8px" : "8px 12px",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const count = item.countFn ? item.countFn() : null;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: collapsed ? "10px 0" : "10px 12px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px",
                fontWeight: isActive ? 500 : 400,
                color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
                background: isActive ? "var(--color-accent-light)" : "transparent",
                textDecoration: "none",
                transition: "all var(--transition-fast)",
                position: "relative",
                minHeight: "40px",
                minWidth: "auto",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "var(--color-border-subtle)";
                  e.currentTarget.style.color = "var(--color-text)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--color-text-secondary)";
                }
              }}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span
                  style={{
                    position: "absolute",
                    left: collapsed ? "50%" : 0,
                    top: collapsed ? "auto" : "6px",
                    bottom: collapsed ? 0 : "6px",
                    width: collapsed ? "20px" : "3px",
                    height: collapsed ? "3px" : "auto",
                    transform: collapsed ? "translateX(-50%)" : "none",
                    borderRadius: "2px",
                    background: "var(--color-accent)",
                  }}
                />
              )}
              <Icon size={18} style={{ flexShrink: 0 }} />
              {!collapsed && (
                <>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {count !== null && (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 500,
                        color: "var(--color-text-muted)",
                        background: "var(--color-border-subtle)",
                        padding: "1px 8px",
                        borderRadius: "var(--radius-pill)",
                        lineHeight: "18px",
                      }}
                    >
                      {count}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Sync indicator */}
      <div
        style={{
          borderTop: "1px solid var(--color-border)",
          padding: collapsed ? "8px" : "8px 12px",
          flexShrink: 0,
        }}
      >
        <SyncIndicator
          state={syncStatus.state}
          lastSync={syncStatus.lastSync}
          collapsed={collapsed}
        />
      </div>

      {/* Collapse toggle */}
      <div
        style={{
          borderTop: "1px solid var(--color-border)",
          padding: collapsed ? "8px" : "8px 12px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: "12px",
            width: "100%",
            padding: "10px 12px",
            border: "none",
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
            transition: "all var(--transition-fast)",
            minHeight: "40px",
            minWidth: "auto",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--color-border-subtle)";
            e.currentTarget.style.color = "var(--color-text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--color-text-muted)";
          }}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <>
              <PanelLeftClose size={18} />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
