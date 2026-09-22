"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import clsx from "clsx";

type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: TooltipPosition;
  className?: string;
}

export function Tooltip({ content, children, position = "top", className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), 300);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  /* Position offsets */
  const positionStyles: Record<TooltipPosition, React.CSSProperties> = {
    top: { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    bottom: { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    left: { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
    right: { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
  };

  /* Arrow rotation */
  const arrowStyles: Record<TooltipPosition, React.CSSProperties> = {
    top: { bottom: "-4px", left: "50%", transform: "translateX(-50%) rotate(45deg)" },
    bottom: { top: "-4px", left: "50%", transform: "translateX(-50%) rotate(45deg)" },
    left: { right: "-4px", top: "50%", transform: "translateY(-50%) rotate(45deg)" },
    right: { left: "-4px", top: "50%", transform: "translateY(-50%) rotate(45deg)" },
  };

  return (
    <span
      ref={triggerRef}
      className={clsx(className)}
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}

      {visible && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            ...positionStyles[position],
            padding: "6px 10px",
            fontSize: "12px",
            fontWeight: 500,
            lineHeight: 1.4,
            color: "#FFFFFF",
            background: "#1A1714",
            borderRadius: "var(--radius-sm)",
            whiteSpace: "nowrap",
            zIndex: 200,
            pointerEvents: "none",
            animation: "tooltip-fade-in 160ms ease-out",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {content}
          {/* Arrow */}
          <span
            style={{
              position: "absolute",
              ...arrowStyles[position],
              width: "8px",
              height: "8px",
              background: "#1A1714",
            }}
          />
        </span>
      )}
    </span>
  );
}

/* ---- Inject keyframes ---- */
if (typeof document !== "undefined") {
  const STYLE_ID = "tooltip-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes tooltip-fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
}
