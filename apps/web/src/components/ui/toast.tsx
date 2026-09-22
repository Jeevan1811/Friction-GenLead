"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

/* ---------- Types ---------- */
type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastApi {
  toast: (message: string, type?: ToastType) => void;
}

/* ---------- Context ---------- */
const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/* ---------- Colors ---------- */
const typeColors: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: "#F0FDF4", border: "#BBF7D0", text: "#166534", icon: "#16A34A" },
  error:   { bg: "#FEF2F2", border: "#FECACA", text: "#991B1B", icon: "#DC2626" },
  info:    { bg: "#EFF6FF", border: "#BFDBFE", text: "#1E40AF", icon: "#2563EB" },
  warning: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E", icon: "#D97706" },
};

/* ---------- Single toast ---------- */
function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const colors = typeColors[item.type];
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(item.id), 220);
    }, 4000);
    return () => clearTimeout(timerRef.current);
  }, [item.id, onDismiss]);

  const handleClose = () => {
    clearTimeout(timerRef.current);
    setExiting(true);
    setTimeout(() => onDismiss(item.id), 220);
  };

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "12px 14px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
        color: colors.text,
        fontSize: "13px",
        fontWeight: 500,
        lineHeight: 1.4,
        minWidth: "280px",
        maxWidth: "420px",
        pointerEvents: "auto",
        animation: exiting
          ? "toast-slide-out 220ms ease-in forwards"
          : "toast-slide-in 220ms ease-out forwards",
      }}
    >
      {/* dot icon */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: colors.icon,
          flexShrink: 0,
        }}
      />

      <span style={{ flex: 1 }}>{item.message}</span>

      <button
        onClick={handleClose}
        aria-label="Dismiss"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          minWidth: 24,
          minHeight: 24,
          border: "none",
          background: "transparent",
          color: colors.text,
          cursor: "pointer",
          borderRadius: "var(--radius-sm)",
          opacity: 0.6,
          transition: "opacity var(--transition-fast)",
          padding: 0,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ---------- Provider ---------- */
let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast container — top-right, outside layout flow */}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---- Inject keyframes ---- */
if (typeof document !== "undefined") {
  const STYLE_ID = "toast-animation-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes toast-slide-in {
        from { opacity: 0; transform: translateX(100%); }
        to   { opacity: 1; transform: translateX(0); }
      }
      @keyframes toast-slide-out {
        from { opacity: 1; transform: translateX(0); }
        to   { opacity: 0; transform: translateX(100%); }
      }
    `;
    document.head.appendChild(style);
  }
}
