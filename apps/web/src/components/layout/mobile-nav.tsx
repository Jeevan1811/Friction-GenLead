"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Building2, Users, History, MoreHorizontal, FileSearch } from "lucide-react";

const mobileNavItems = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/searches", label: "Searches", icon: History },
  { href: "/source-data", label: "Source", icon: FileSearch },
  { href: "/rejected", label: "More", icon: MoreHorizontal },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
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
        const isActive =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(item.href));
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
              color: isActive
                ? "var(--color-accent)"
                : "var(--color-text-muted)",
              transition: "color var(--transition-fast)",
            }}
          >
            <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
            <span
              style={{
                fontSize: "9px",
                fontWeight: isActive ? 600 : 400,
                lineHeight: 1,
              }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
