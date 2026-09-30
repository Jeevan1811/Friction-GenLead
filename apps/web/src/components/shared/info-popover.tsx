"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

export function InfoPopover({ label, text }: { label: string; text: string }) {
  const id = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  return (
    <span className="genlead-info" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="genlead-info-trigger"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) {
            const panelWidth = Math.min(296, window.innerWidth - 24);
            setPlacement({
              top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 132)),
              left: Math.max(12, Math.min(rect.left, window.innerWidth - panelWidth - 12)),
            });
          }
          setOpen((current) => !current);
        }}
      >
        <Info size={15} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          ref={panelRef}
          role="dialog"
          aria-label={`About ${label}`}
          tabIndex={-1}
          className="genlead-info-panel"
          style={{ top: placement.top, left: placement.left }}
        >
          <strong>{label}</strong>
          <span>{text}</span>
        </span>
      )}
    </span>
  );
}
