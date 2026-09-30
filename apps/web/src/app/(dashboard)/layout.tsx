"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandPalette } from "@/components/shared/command-palette";
import { ChatSidebar } from "@/components/shared/chat-sidebar";
import { DashboardTourProvider } from "@/components/shared/dashboard-tour";
import { ToastProvider } from "@/components/ui/toast";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };
    onChange(mq);
    mq.addEventListener("change", onChange as (e: MediaQueryListEvent) => void);
    return () =>
      mq.removeEventListener(
        "change",
        onChange as (e: MediaQueryListEvent) => void
      );
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setCmdOpen((o) => !o);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <ToastProvider>
      <DashboardTourProvider>
      <div style={{ display: "flex", minHeight: "100dvh" }}>
        <div style={{ display: isMobile ? "none" : "contents" }}>
          <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        </div>
        <div
          className="genlead-dashboard-content"
          data-collapsed={collapsed}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: "100dvh",
          }}
        >
          <Header onOpenCommandPalette={() => setCmdOpen(true)} />
          <main
            style={{
              flex: 1,
              overflowY: "auto",
              paddingBottom: isMobile ? "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px) + 16px)" : undefined,
            }}
          >
            <div
              key={pathname}
              className="page-transition"
            >
              {children}
            </div>
          </main>
        </div>
        {isMobile && <MobileNav />}
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
        <ChatSidebar />
      </div>
      </DashboardTourProvider>
    </ToastProvider>
  );
}
