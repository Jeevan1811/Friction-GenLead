"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Send, Bot, Loader2 } from "lucide-react";
import { getSyncStatus, sendChatMessage } from "@/lib/api";
import { ChatRichText } from "@/components/shared/chat-rich-text";
import { buildGoogleSheetUrl } from "@/lib/google-sheets-link.mjs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "genlead-chat-messages";
const GREETING =
  "Hi, I'm GenLead. Ask about using the app or your live Sheet data. I can show an example screen or open the right page.\n\n[[sheet]]";

const SUGGESTIONS = [
  "How do I review a company?",
  "Which follow-ups are due?",
  "What did my latest search find?",
  "Where can I find original Excel fields?",
];

function loadMessages(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* empty */
  }
  return [{ role: "assistant", content: GREETING }];
}

function saveMessages(msgs: ChatMessage[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function ChatSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null | undefined>(undefined);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* Auto-scroll */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  /* Focus input on open */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /* Resolve a validated link to this account's live Sheet when help is opened. */
  useEffect(() => {
    if (!open || sheetUrl !== undefined) return;
    let current = true;
    getSyncStatus()
      .then((status) => {
        if (current) setSheetUrl(buildGoogleSheetUrl(status.spreadsheetId));
      })
      .catch(() => {
        if (current) setSheetUrl(null);
      });
    return () => {
      current = false;
    };
  }, [open, sheetUrl]);

  /* Persist */
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || loading) return;

      const userMsg: ChatMessage = { role: "user", content: text };
      const next = [...messages, userMsg];
      setMessages(next);
      setInput("");
      setLoading(true);

      try {
        const res = await sendChatMessage(
          next.map((m) => ({ role: m.role, content: m.content })),
          { page: pathname }
        );
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: res.response },
        ]);
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Something went wrong";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Sorry, I couldn't process that. ${errMsg}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, pathname]
  );

  const handleSend = useCallback(() => send(input), [send, input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Toggle button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 9990,
            width: 52,
            height: 52,
            minWidth: 44,
            minHeight: 44,
            borderRadius: "50%",
            border: "none",
            background: "var(--color-accent)",
            color: "#FFFFFF",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "var(--shadow-lg)",
            transition: "transform var(--transition-fast), box-shadow var(--transition-fast)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <MessageCircle size={22} />
        </button>
      )}

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "380px",
          maxWidth: "100vw",
          zIndex: 9991,
          display: "flex",
          flexDirection: "column",
          background: "var(--color-surface)",
          borderLeft: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-lg)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <Bot size={20} style={{ color: "var(--color-accent)" }} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--color-text)",
              }}
            >
              GenLead AI
            </div>
            <span
              style={{
                display: "inline-block",
                fontSize: "10px",
                fontWeight: 500,
                padding: "1px 6px",
                borderRadius: "var(--radius-pill)",
                background: "var(--color-accent-light)",
                color: "var(--color-accent)",
                lineHeight: "16px",
              }}
            >
              Llama 3.3
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              minWidth: 32,
              minHeight: 32,
              border: "none",
              background: "transparent",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              borderRadius: "var(--radius-sm)",
              transition: "background var(--transition-fast)",
              padding: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-border-subtle)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent:
                  msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "85%",
                  padding: "10px 14px",
                  borderRadius:
                    msg.role === "user"
                      ? "var(--radius-md) var(--radius-md) 4px var(--radius-md)"
                      : "var(--radius-md) var(--radius-md) var(--radius-md) 4px",
                  background:
                    msg.role === "user"
                      ? "var(--color-accent)"
                      : "var(--color-bg)",
                  color:
                    msg.role === "user"
                      ? "#FFFFFF"
                      : "var(--color-text)",
                  fontSize: "13px",
                  lineHeight: 1.5,
                  whiteSpace: msg.role === "user" ? "pre-wrap" : "normal",
                  wordBreak: "break-word",
                }}
              >
                {msg.role === "assistant" ? (
                  <ChatRichText content={msg.content} sheetUrl={sheetUrl} />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}

          {/* Starter questions */}
          {messages.length === 1 && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" }}>
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  style={{
                    textAlign: "left",
                    padding: "7px 12px",
                    fontSize: "12px",
                    lineHeight: 1.4,
                    borderRadius: "var(--radius-pill)",
                    border: "1px solid var(--color-border)",
                    background: "transparent",
                    color: "var(--color-accent)",
                    cursor: "pointer",
                    minHeight: 0,
                    minWidth: 0,
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 14px",
                  borderRadius:
                    "var(--radius-md) var(--radius-md) var(--radius-md) 4px",
                  background: "var(--color-bg)",
                  color: "var(--color-text-muted)",
                  fontSize: "13px",
                }}
              >
                <Loader2
                  size={14}
                  style={{ animation: "spin 1s linear infinite" }}
                />
                Thinking...
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "8px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              padding: "8px 12px",
              transition: "border-color var(--transition-fast)",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask GenLead AI..."
              rows={1}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--color-text)",
                fontSize: "13px",
                lineHeight: 1.5,
                resize: "none",
                fontFamily: "var(--font-sans)",
                maxHeight: "120px",
                padding: 0,
                minHeight: "20px",
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              aria-label="Send message"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                minWidth: 32,
                minHeight: 32,
                border: "none",
                borderRadius: "var(--radius-sm)",
                background:
                  input.trim() && !loading
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                color: "#FFFFFF",
                cursor:
                  input.trim() && !loading ? "pointer" : "not-allowed",
                transition: "background var(--transition-fast)",
                padding: 0,
                flexShrink: 0,
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Backdrop on mobile */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9990,
            background: "rgba(0, 0, 0, 0.3)",
            display: "none",
          }}
          className="chat-backdrop-mobile"
        />
      )}
    </>
  );
}

/* Inject spinner + mobile backdrop keyframes */
if (typeof document !== "undefined") {
  const STYLE_ID = "chat-sidebar-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @media (max-width: 768px) {
        .chat-backdrop-mobile { display: block !important; }
      }
    `;
    document.head.appendChild(style);
  }
}
