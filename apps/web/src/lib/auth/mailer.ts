/**
 * OTP email delivery via Hostinger SMTP (nodemailer).
 *
 * `sendOtpEmail` takes an optional `transporter` for dependency injection
 * so the surrounding call/format logic can be exercised in tests without a
 * real SMTP connection — see apps/web/src/lib/auth/mailer.smoke-test.mjs.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { requireEnv } from "./env";

let cachedTransporter: Transporter | null = null;

function getDefaultTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: requireEnv("SMTP_HOST"),
    port: Number(requireEnv("SMTP_PORT")),
    secure: true, // port 465 = implicit TLS/SSL
    auth: {
      user: requireEnv("SMTP_USER"),
      pass: requireEnv("SMTP_PASS"),
    },
  });
  return cachedTransporter;
}

export async function sendOtpEmail(
  to: string,
  code: string,
  transporter: Pick<Transporter, "sendMail"> = getDefaultTransporter()
): Promise<void> {
  const from = requireEnv("SMTP_FROM");
  // Never log `code` — this function's only job is to hand it to SMTP.
  await transporter.sendMail({
    from,
    to,
    subject: "Your Friction GenLead login code",
    text: `Your one-time login code is ${code}. It expires in 5 minutes.\n\nIf you did not request this, you can ignore this email.`,
    html:
      `<p>Your one-time login code is:</p>` +
      `<p style="font-size:28px;font-weight:600;letter-spacing:4px;">${code}</p>` +
      `<p>It expires in 5 minutes.</p>` +
      `<p style="color:#6B6560;font-size:12px;">If you did not request this, you can ignore this email.</p>`,
  });
}

/**
 * Emails the OTP used for the password setup/reset flow. Same delivery
 * path as the login OTP, different copy so the account owner can tell the
 * two apart (and separate subject line, so it's not confused with a login
 * they didn't initiate).
 */
export async function sendPasswordResetEmail(
  to: string,
  code: string,
  isFirstSetup: boolean,
  transporter: Pick<Transporter, "sendMail"> = getDefaultTransporter()
): Promise<void> {
  const from = requireEnv("SMTP_FROM");
  const subject = isFirstSetup
    ? "Set up your Friction GenLead password"
    : "Reset your Friction GenLead password";
  const intro = isFirstSetup
    ? "Use this code to set up your password:"
    : "Use this code to reset your password:";
  // Never log `code` — this function's only job is to hand it to SMTP.
  await transporter.sendMail({
    from,
    to,
    subject,
    text: `${intro} ${code}. It expires in 5 minutes.\n\nIf you did not request this, you can ignore this email.`,
    html:
      `<p>${intro}</p>` +
      `<p style="font-size:28px;font-weight:600;letter-spacing:4px;">${code}</p>` +
      `<p>It expires in 5 minutes.</p>` +
      `<p style="color:#6B6560;font-size:12px;">If you did not request this, you can ignore this email.</p>`,
  });
}
