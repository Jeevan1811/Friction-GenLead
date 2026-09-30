"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { useAnchoredPanel } from "@/components/ui/use-anchored-panel";

export function InfoPopover({ label, text }: { label: string; text: string }) {
  const id = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const placement = useAnchoredPanel(open, triggerRef, panelRef, 296);

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
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
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
        onClick={() => setOpen((current) => !current)}
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
          style={placement}
        >
          <strong>{label}</strong>
          <span>{text}</span>
        </span>
      )}
    </span>
  );
}
