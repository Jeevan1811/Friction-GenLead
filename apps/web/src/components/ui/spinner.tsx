"use client";

import clsx from "clsx";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = { sm: 16, md: 24, lg: 32 } as const;

export function Spinner({ size = "md", className }: SpinnerProps) {
  const px = sizeMap[size];
  const stroke = size === "sm" ? 2.5 : 2;

  return (
    <svg
      className={clsx("spinner-rotate", className)}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="var(--color-border)"
        strokeWidth={stroke}
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="var(--color-accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---- CSS injected once ---- */
if (typeof document !== "undefined") {
  const STYLE_ID = "spinner-rotate-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes spinner-spin {
        to { transform: rotate(360deg); }
      }
      .spinner-rotate {
        animation: spinner-spin 0.75s linear infinite;
      }
    `;
    document.head.appendChild(style);
  }
}
