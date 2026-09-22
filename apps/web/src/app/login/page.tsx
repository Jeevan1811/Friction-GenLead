"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, ShieldCheck, Loader2, ArrowLeft } from "lucide-react";

type Step = "credentials" | "otp";

export default function LoginPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");

  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "otp") {
      codeInputRef.current?.focus();
    }
  }, [step]);

  const handleCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid email or password");
        return;
      }
      setPendingToken(data.pendingToken);
      setMaskedEmail(maskEmail(email));
      setStep("otp");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Incorrect code.");
        if (
          data.error?.includes("expired") ||
          data.error?.includes("Too many")
        ) {
          // Force a fresh login rather than letting them keep guessing.
          setStep("credentials");
          setPassword("");
          setCode("");
          setPendingToken("");
        }
        return;
      }
      router.push("/search");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "400px" }}>
        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 48,
              height: 48,
              borderRadius: "var(--radius-md)",
              background: "var(--color-accent-light)",
              color: "var(--color-accent)",
              marginBottom: "16px",
            }}
          >
            <Lock size={22} strokeWidth={1.75} />
          </div>
          <h1
            style={{
              fontSize: "22px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
            }}
          >
            Friction GenLead
          </h1>
          <p
            style={{
              fontSize: "13px",
              color: "var(--color-text-secondary)",
              marginTop: "4px",
            }}
          >
            {step === "credentials"
              ? "Sign in to continue"
              : "Enter the code we emailed you"}
          </p>
        </div>

        <div className="surface-card" style={{ padding: "28px" }}>
          {step === "credentials" ? (
            <form
              onSubmit={handleCredentialsSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <div>
                <label htmlFor="email" className="text-label" style={{ display: "block", marginBottom: "6px" }}>
                  Email
                </label>
                <div style={{ position: "relative" }}>
                  <Mail
                    size={16}
                    style={{
                      position: "absolute",
                      left: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--color-text-muted)",
                    }}
                  />
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-field"
                    style={{ paddingLeft: "38px" }}
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="text-label" style={{ display: "block", marginBottom: "6px" }}>
                  Password
                </label>
                <div style={{ position: "relative" }}>
                  <Lock
                    size={16}
                    style={{
                      position: "absolute",
                      left: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--color-text-muted)",
                    }}
                  />
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field"
                    style={{ paddingLeft: "38px" }}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {error && <ErrorMessage text={error} />}

              <button
                type="submit"
                disabled={submitting || !email || !password}
                className="btn-primary"
                style={{ width: "100%", marginTop: "4px" }}
              >
                {submitting ? (
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <Lock size={16} />
                )}
                {submitting ? "Signing in..." : "Continue"}
              </button>
            </form>
          ) : (
            <form
              onSubmit={handleOtpSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                We sent a 6-digit code to <strong style={{ color: "var(--color-text)" }}>{maskedEmail}</strong>.
                It expires in 5 minutes.
              </p>

              <div>
                <label htmlFor="code" className="text-label" style={{ display: "block", marginBottom: "6px" }}>
                  Verification code
                </label>
                <div style={{ position: "relative" }}>
                  <ShieldCheck
                    size={16}
                    style={{
                      position: "absolute",
                      left: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--color-text-muted)",
                    }}
                  />
                  <input
                    ref={codeInputRef}
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="input-field"
                    style={{
                      paddingLeft: "38px",
                      letterSpacing: "4px",
                      fontFamily: "var(--font-mono)",
                    }}
                    placeholder="000000"
                  />
                </div>
              </div>

              {error && <ErrorMessage text={error} />}

              <button
                type="submit"
                disabled={submitting || code.length !== 6}
                className="btn-primary"
                style={{ width: "100%", marginTop: "4px" }}
              >
                {submitting ? (
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <ShieldCheck size={16} />
                )}
                {submitting ? "Verifying..." : "Verify & sign in"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("credentials");
                  setCode("");
                  setError("");
                }}
                className="btn-secondary"
                style={{ width: "100%" }}
              >
                <ArrowLeft size={14} />
                Back
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorMessage({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: "12px",
        color: "var(--color-error)",
        background: "var(--color-accent-light)",
        border: "1px solid var(--color-error)",
        borderRadius: "var(--radius-sm)",
        padding: "10px 12px",
      }}
      role="alert"
    >
      {text}
    </div>
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}
