"use client";

import { useLayoutEffect, useState, type RefObject, type CSSProperties } from "react";

/** Size and flip a panel using its rendered content, not a guessed text height. */
export function useAnchoredPanel(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  preferredWidth: number,
  preferredMaxHeight = 440,
): CSSProperties {
  const [placement, setPlacement] = useState({ top: 12, left: 12, width: preferredWidth, maxHeight: preferredMaxHeight });

  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    let frame = 0;
    const place = () => {
      const anchor = trigger.current;
      const content = panel.current;
      if (!anchor || !content) return;
      const gutter = 12;
      const width = Math.min(preferredWidth, window.innerWidth - gutter * 2);
      const maxHeight = Math.min(preferredMaxHeight, window.innerHeight - gutter * 2);
      content.style.width = `${width}px`;
      content.style.maxHeight = `${maxHeight}px`;
      const rect = anchor.getBoundingClientRect();
      const height = content.getBoundingClientRect().height;
      const below = rect.bottom + 8;
      const above = rect.top - height - 8;
      const top = below + height <= window.innerHeight - gutter ? below
        : above >= gutter ? above
        : Math.max(gutter, window.innerHeight - height - gutter);
      const left = Math.max(gutter, Math.min(rect.right - width, window.innerWidth - width - gutter));
      setPlacement(old => old.top === top && old.left === left && old.width === width && old.maxHeight === maxHeight
        ? old : { top, left, width, maxHeight });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place();
    const observer = new ResizeObserver(schedule);
    observer.observe(panel.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, trigger, panel, preferredWidth, preferredMaxHeight]);

  return { position: "fixed", ...placement };
}
