"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, ShieldCheck, Loader2, ArrowLeft, KeyRound } from "lucide-react";

type Step = "credentials" | "otp" | "reset-request" | "reset-confirm";
type ResetMode = "setup" | "forgot";

export default function LoginPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("credentials");
  const [resetMode, setResetMode] = useState<ResetMode>("forgot");

  // Normal login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");

  // Setup / forgot-password state
  const [resetEmail, setResetEmail] = useState("");
  const [resetPendingToken, setResetPendingToken] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetMaskedEmail, setResetMaskedEmail] = useState("");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const codeInputRef = useRef<HTMLInputElement>(null);
  const resetCodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "otp") codeInputRef.current?.focus();
    if (step === "reset-confirm") resetCodeInputRef.current?.focus();
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
        if (data.passwordNotSet) {
          setResetEmail(email);
          setResetMode("setup");
          setStep("reset-request");
          return;
        }
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
        if (data.error?.includes("expired") || data.error?.includes("Too many")) {
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

  const handleResetRequestSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password/request-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not send the code.");
        return;
      }
      setResetPendingToken(data.pendingToken);
      setResetMode(data.isFirstSetup ? "setup" : "forgot");
      setResetMaskedEmail(maskEmail(resetEmail));
      setNewPassword("");
      setConfirmPassword("");
      setResetCode("");
      setStep("reset-confirm");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetConfirmSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken: resetPendingToken, code: resetCode, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not reset the password.");
        if (data.error?.includes("expired") || data.error?.includes("Too many")) {
          setStep("reset-request");
          setResetPendingToken("");
          setResetCode("");
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

  const stepSubtitle: Record<Step, string> = {
    credentials: "Sign in to continue",
    otp: "Enter the code we emailed you",
    "reset-request": "First time here, or forgot your password?",
    "reset-confirm":
      resetMode === "setup" ? "Set your password" : "Choose a new password",
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
            {stepSubtitle[step]}
          </p>
        </div>

        <div className="surface-card" style={{ padding: "28px" }}>
          {step === "credentials" && (
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
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <label htmlFor="password" className="text-label">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setResetEmail(email);
                      setStep("reset-request");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      fontSize: "12px",
                      color: "var(--color-accent)",
                      cursor: "pointer",
                    }}
                  >
                    First time / forgot password?
                  </button>
                </div>
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
          )}

          {step === "otp" && (
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
                    style={{ paddingLeft: "38px", letterSpacing: "4px", fontFamily: "var(--font-mono)" }}
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

          {step === "reset-request" && (
            <form
              onSubmit={handleResetRequestSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Enter your email and we'll send you a code — to set up a password if
                you don't have one yet, or to reset it if you've forgotten it.
              </p>

              <div>
                <label htmlFor="reset-email" className="text-label" style={{ display: "block", marginBottom: "6px" }}>
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
                    id="reset-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="input-field"
                    style={{ paddingLeft: "38px" }}
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              {error && <ErrorMessage text={error} />}

              <button
                type="submit"
                disabled={submitting || !resetEmail}
                className="btn-primary"
                style={{ width: "100%", marginTop: "4px" }}
              >
                {submitting ? (
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <KeyRound size={16} />
                )}
                {submitting ? "Sending..." : "Send code"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("credentials");
                  setError("");
                }}
                className="btn-secondary"
                style={{ width: "100%" }}
              >
                <ArrowLeft size={14} />
                Back to sign in
              </button>
            </form>
          )}

          {step === "reset-confirm" && (
            <form
              onSubmit={handleResetConfirmSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                We sent a 6-digit code to <strong style={{ color: "var(--color-text)" }}>{resetMaskedEmail}</strong>.
                It expires in 5 minutes.
              </p>

              <div>
                <label htmlFor="reset-code" className="text-label" style={{ display: "block", marginBottom: "6px" }}>
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
                    ref={resetCodeInputRef}
                    id="reset-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="input-field"
                    style={{ paddingLeft: "38px", letterSpacing: "4px", fontFamily: "var(--font-mono)" }}
                    placeholder="000000"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="new-password" className="text-label" style={{ display: "block", marginBottom: "6px" }}>
                  New password
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
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field"
                    style={{ paddingLeft: "38px" }}
                    placeholder="At least 8 characters"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="confirm-password" className="text-label" style={{ display: "block", marginBottom: "6px" }}>
                  Confirm password
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
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input-field"
                    style={{ paddingLeft: "38px" }}
                    placeholder="Re-enter password"
                  />
                </div>
              </div>

              {error && <ErrorMessage text={error} />}

              <button
                type="submit"
                disabled={submitting || resetCode.length !== 6 || !newPassword || !confirmPassword}
                className="btn-primary"
                style={{ width: "100%", marginTop: "4px" }}
              >
                {submitting ? (
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <ShieldCheck size={16} />
                )}
                {submitting
                  ? "Saving..."
                  : resetMode === "setup"
                    ? "Set password & sign in"
                    : "Reset password & sign in"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("reset-request");
                  setResetCode("");
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
