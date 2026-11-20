import crypto from 'node:crypto';
import nodemailer, { type Transporter, type TransportOptions } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SmtpConfigStatus {
  configured: boolean;
  missing: string[];
  error?: string;
}

export interface SmtpDiagnostics {
  configured: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  starttls: boolean;
  missing: string[];
  error?: string;
  legacyBrevoEnvPresent: boolean;
}

export type EmailSenderFn = (message: EmailMessage) => Promise<void>;
export type CreateTransportFn = (options: Record<string, unknown>) => Transporter;

let testEmailSender: EmailSenderFn | null = null;
let testCreateTransport: CreateTransportFn | null = null;
let cachedTransporter: Transporter | null = null;
let cachedTransporterKey = '';

export function setEmailSenderForTesting(sender: EmailSenderFn | null): void {
  testEmailSender = sender;
}

export function setCreateTransportForTesting(factory: CreateTransportFn | null): void {
  testCreateTransport = factory;
  cachedTransporter = null;
  cachedTransporterKey = '';
}

export function resetEmailSenderForTesting(): void {
  testEmailSender = null;
  testCreateTransport = null;
  cachedTransporter = null;
  cachedTransporterKey = '';
}

function isDisallowedBrevoHost(host: string): boolean {
  return /\b(brevo\.com|sendinblue\.com)\b/i.test(host);
}

function isPlaceholderValue(value: string): boolean {
  return /^REPLACE_WITH_/i.test(value) || /^YOUR_/i.test(value);
}

function getSmtpSettings() {
  const host = process.env.SMTP_HOST?.trim() || '';
  const portRaw = process.env.SMTP_PORT?.trim() || '';
  const port = portRaw ? Number(portRaw) : NaN;
  const user = process.env.SMTP_USER?.trim() || '';
  const rawPassword = (process.env.SMTP_PASSWORD ?? '').trim();
  // Google displays 16-char Gmail App Passwords in 4-char space-separated groups; strip whitespace for Gmail SMTP AUTH
  const password = host.toLowerCase() === 'smtp.gmail.com' ? rawPassword.replace(/\s+/g, '') : rawPassword;
  const from = process.env.SMTP_FROM?.trim() || '';

  // Port 587 uses STARTTLS (secure=false, requireTLS=true). Port 465 uses implicit TLS (secure=true).
  const secure = port === 465 ? true : port === 587 ? false : process.env.SMTP_SECURE === 'true';
  const requireTLS = !secure && (port === 587 || host.toLowerCase() === 'smtp.gmail.com');

  return { host, port, portRaw, user, password, from, secure, requireTLS };
}

export function validateSmtpConfig(): SmtpConfigStatus {
  if (testEmailSender) {
    return { configured: true, missing: [] };
  }

  const { host, port, portRaw, user, password, from } = getSmtpSettings();
  const missing: string[] = [];
  if (!host || isPlaceholderValue(host)) missing.push('SMTP_HOST');
  if (!portRaw || !Number.isInteger(port) || port < 1 || port > 65535) missing.push('SMTP_PORT');
  if (!user || isPlaceholderValue(user)) missing.push('SMTP_USER');
  if (!password || isPlaceholderValue(password)) missing.push('SMTP_PASSWORD');
  if (!from || isPlaceholderValue(from) || !from.includes('@')) missing.push('SMTP_FROM');

  if (missing.length > 0) {
    return {
      configured: false,
      missing,
      error: `Missing or invalid SMTP environment variables: ${missing.join(', ')}.`,
    };
  }

  if (isDisallowedBrevoHost(host)) {
    return {
      configured: false,
      missing: [],
      error: 'Brevo SMTP is disabled. Configure Gmail SMTP with SMTP_HOST=smtp.gmail.com and SMTP_PORT=587.',
    };
  }

  return {
    configured: true,
    missing: [],
  };
}

export function isSmtpConfigured(): boolean {
  return validateSmtpConfig().configured;
}

export function getSmtpDiagnostics(): SmtpDiagnostics {
  const { host, port, secure, requireTLS } = getSmtpSettings();
  const status = validateSmtpConfig();
  const legacyBrevoEnvPresent = Boolean(
    process.env.BREVO_API_KEY?.trim() ||
      process.env.SENDINBLUE_API_KEY?.trim() ||
      process.env.BREVO_SMTP_KEY?.trim()
  );

  return {
    configured: status.configured,
    host: host || null,
    port: Number.isInteger(port) && port > 0 ? port : null,
    secure,
    starttls: requireTLS,
    missing: status.missing,
    error: status.error,
    legacyBrevoEnvPresent,
  };
}

export function logSmtpStartupDiagnostics(): void {
  const diag = getSmtpDiagnostics();
  if (diag.configured) {
    console.log(
      `[InkloomGuard AI] Email transport ready: host=${diag.host}, port=${diag.port}, secure=${diag.secure}, starttls=${diag.starttls}`
    );
  } else {
    console.warn(
      `[InkloomGuard AI] Email transport inactive (host=${diag.host || 'unset'}, port=${diag.port ?? 'unset'}): ${diag.error}`
    );
  }
  if (diag.legacyBrevoEnvPresent) {
    console.warn(
      '[InkloomGuard AI] Legacy Brevo environment variable detected; Brevo integration is disabled. Remove unused Brevo variables from deployment settings.'
    );
  }
}

export function formatSmtpError(err: unknown): string {
  const { host, port, password } = getSmtpSettings();
  const errObj = (err && typeof err === 'object' ? err : {}) as {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
    message?: unknown;
  };

  const code = typeof errObj.code === 'string' ? errObj.code : '';
  const responseCode = typeof errObj.responseCode === 'number' ? errObj.responseCode : null;
  let rawMessage = err instanceof Error ? err.message : String(err || 'Unknown SMTP error');
  if (password) {
    rawMessage = rawMessage.split(password).join('[REDACTED]');
  }

  if (/Brevo SMTP is disabled/i.test(rawMessage)) {
    return rawMessage;
  }

  if (
    code === 'EAUTH' ||
    responseCode === 535 ||
    responseCode === 534 ||
    /Username and Password not accepted|Application-specific password required|Invalid login/i.test(rawMessage)
  ) {
    return 'Gmail SMTP authentication failed (535/EAUTH). Verify SMTP_USER and ensure SMTP_PASSWORD is a valid 16-character Google App Password (with 2-Step Verification enabled).';
  }

  if (/WRONG_VERSION_NUMBER|TLS|SSL|certificate/i.test(rawMessage)) {
    return `SMTP TLS/STARTTLS negotiation failed on ${host || 'unset'}:${port || 'unset'}. For Gmail SMTP port 587, use secure=false with STARTTLS.`;
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKET' ||
    code === 'ECONNECTION' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    /timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(rawMessage)
  ) {
    return `Unable to connect to SMTP server ${host || 'unset'}:${port || 'unset'} (${code || 'network error'}). Check SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, and outbound network access.`;
  }

  if (code === 'EENVELOPE' || responseCode === 550 || responseCode === 553 || responseCode === 554) {
    return 'SMTP server rejected the sender or recipient address. Ensure SMTP_FROM uses your authenticated Gmail address or a verified Gmail Send-As alias.';
  }

  return `SMTP delivery error (${code || responseCode || 'transport'}): ${rawMessage}`;
}

export function getTransporter(): Transporter {
  const validation = validateSmtpConfig();
  if (!validation.configured) {
    throw new Error(validation.error || `Email service is not configured. Missing: ${validation.missing.join(', ')}.`);
  }

  const { host, port, user, password, secure, requireTLS } = getSmtpSettings();
  const passwordDigest = crypto.createHash('sha256').update(password).digest('hex').slice(0, 12);
  const key = `${host}:${port}:${user}:${secure ? '1' : '0'}:${requireTLS ? '1' : '0'}:${passwordDigest}`;

  if (!cachedTransporter || cachedTransporterKey !== key) {
    const factory: CreateTransportFn =
      testCreateTransport || ((opts) => nodemailer.createTransport(opts as TransportOptions));

    cachedTransporter = factory({
      host,
      port,
      secure,
      requireTLS,
      auth: {
        user,
        pass: password,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    cachedTransporterKey = key;
  }
  return cachedTransporter;
}

export function resolveAppBaseUrl(requestOrigin?: string): string {
  const configured =
    process.env.APP_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim();

  const candidate = configured || requestOrigin || 'http://localhost:3000';
  return candidate.replace(/\/+$/, '');
}

export function buildAppActionUrl(pathWithQuery: string, requestOrigin?: string): string {
  const base = resolveAppBaseUrl(requestOrigin);
  const normalizedPath = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  return `${base}${normalizedPath}`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInkloomEmailLayout(params: {
  preheader: string;
  heading: string;
  greetingName: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footnote: string;
}): string {
  const safeName = escapeHtml(params.greetingName || 'there');
  const safeHeading = escapeHtml(params.heading);
  const safePreheader = escapeHtml(params.preheader);
  const safeFootnote = escapeHtml(params.footnote);
  const safeCtaUrl = params.ctaUrl ? escapeHtml(params.ctaUrl) : '';
  const safeCtaLabel = params.ctaLabel ? escapeHtml(params.ctaLabel) : '';

  const ctaSection =
    params.ctaUrl && params.ctaLabel
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0;">
          <tr>
            <td align="center" style="border-radius: 9999px; background: linear-gradient(135deg, #6366F1 0%, #4F46E5 60%, #3525CD 100%);">
              <a href="${safeCtaUrl}" target="_blank" rel="noopener noreferrer"
                 style="display: inline-block; padding: 14px 28px; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 9999px;">
                ${safeCtaLabel}
              </a>
            </td>
          </tr>
        </table>
        <p style="margin: 0 0 18px 0; font-size: 12px; line-height: 1.6; color: #64748b; word-break: break-all;">
          If the button does not work, copy and paste this link into your browser:<br />
          <a href="${safeCtaUrl}" style="color: #4F46E5; text-decoration: underline;">${safeCtaUrl}</a>
        </p>
      `
      : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeHeading} — InkloomGuard AI</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #eef1fc; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #181445;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${safePreheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #eef1fc; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 580px; background-color: #ffffff; border-radius: 28px; border: 1px solid #dde2f8; box-shadow: 0 18px 36px -12px rgba(79, 70, 229, 0.16); overflow: hidden;">
            <tr>
              <td style="padding: 28px 32px; background: linear-gradient(135deg, #181445 0%, #312e81 65%, #4f46e5 100%); color: #ffffff;">
                <p style="margin: 0 0 4px 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: #ffffff;">
                  InkloomGuard AI
                </p>
                <p style="margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #c7d2fe;">
                  Check. Correct. Comply.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px;">
                <h1 style="margin: 0 0 14px 0; font-size: 22px; font-weight: 800; color: #181445; letter-spacing: -0.02em;">
                  ${safeHeading}
                </h1>
                <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #334155;">
                  Hello ${safeName},
                </p>
                <div style="font-size: 14px; line-height: 1.65; color: #334155;">
                  ${params.bodyHtml}
                </div>
                ${ctaSection}
                <div style="margin-top: 24px; padding: 14px 16px; background-color: #f4f5fd; border-radius: 16px; border: 1px solid #e2e8f0;">
                  <p style="margin: 0; font-size: 12px; line-height: 1.55; color: #475569;">
                    ${safeFootnote}
                  </p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 32px; background-color: #f8f9fe; border-top: 1px solid #e8ecf8; text-align: center;">
                <p style="margin: 0; font-size: 12px; font-weight: 700; color: #4f46e5;">
                  InkloomGuard AI · Check. Correct. Comply.
                </p>
                <p style="margin: 4px 0 0 0; font-size: 11px; color: #64748b;">
                  Enterprise Brand Compliance &amp; Governance Security Notification
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (testEmailSender) {
    await testEmailSender(message);
    return;
  }

  const { from } = getSmtpSettings();
  const transporter = getTransporter();

  try {
    await transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  } catch (err) {
    throw new Error(formatSmtpError(err));
  }
}

export async function sendVerificationEmail(params: {
  to: string;
  name: string;
  companyName: string;
  verificationUrl: string;
  expiresHours: number;
}): Promise<void> {
  const safeCompany = escapeHtml(params.companyName);
  const bodyHtml = `
    <p style="margin: 0 0 12px 0;">
      Welcome to <strong>InkloomGuard AI</strong> for <strong>${safeCompany}</strong>. Please verify your email address to confirm your account security settings.
    </p>
    <p style="margin: 0;">
      This single-use verification link will remain active for <strong>${params.expiresHours} hours</strong>.
    </p>
  `;

  const html = renderInkloomEmailLayout({
    preheader: 'Verify your InkloomGuard AI email address.',
    heading: 'Verify Your Email Address',
    greetingName: params.name,
    bodyHtml,
    ctaLabel: 'Verify Email Address',
    ctaUrl: params.verificationUrl,
    footnote:
      'If you did not create an InkloomGuard AI account, you can safely ignore this message. No action will be taken.',
  });

  const text = [
    'InkloomGuard AI — Check. Correct. Comply.',
    '',
    `Hello ${params.name},`,
    '',
    `Welcome to InkloomGuard AI (${params.companyName}). Please verify your email address using this single-use link (valid for ${params.expiresHours} hours):`,
    params.verificationUrl,
    '',
    'If you did not create this account, you can safely ignore this email.',
  ].join('\n');

  await sendEmail({
    to: params.to,
    subject: 'Verify your email address — InkloomGuard AI',
    html,
    text,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
  expiresMinutes: number;
}): Promise<void> {
  const bodyHtml = `
    <p style="margin: 0 0 12px 0;">
      We received a request to reset the password for your <strong>InkloomGuard AI</strong> account.
    </p>
    <p style="margin: 0;">
      For your security, this single-use link expires in <strong>${params.expiresMinutes} minutes</strong> and will invalidate any active sessions once completed.
    </p>
  `;

  const html = renderInkloomEmailLayout({
    preheader: 'Reset your InkloomGuard AI account password.',
    heading: 'Reset Your Password',
    greetingName: params.name,
    bodyHtml,
    ctaLabel: 'Reset Password',
    ctaUrl: params.resetUrl,
    footnote:
      'If you did not request a password reset, you can safely ignore this email. Your existing password remains unchanged.',
  });

  const text = [
    'InkloomGuard AI — Check. Correct. Comply.',
    '',
    `Hello ${params.name},`,
    '',
    `We received a request to reset your InkloomGuard AI password. Use the single-use link below within ${params.expiresMinutes} minutes:`,
    params.resetUrl,
    '',
    'If you did not request a password reset, you can safely ignore this email.',
  ].join('\n');

  await sendEmail({
    to: params.to,
    subject: 'Reset your password — InkloomGuard AI',
    html,
    text,
  });
}

export async function sendPasswordChangedEmail(params: {
  to: string;
  name: string;
  companyName: string;
  changedAtIso: string;
}): Promise<void> {
  const safeCompany = escapeHtml(params.companyName);
  const safeTimestamp = escapeHtml(new Date(params.changedAtIso).toUTCString());
  const bodyHtml = `
    <p style="margin: 0 0 12px 0;">
      This is a security confirmation that the password for your <strong>InkloomGuard AI</strong> account (${safeCompany}) was changed on <strong>${safeTimestamp}</strong>.
    </p>
    <p style="margin: 0;">
      All other active sessions have been signed out automatically to protect your organization workspace.
    </p>
  `;

  const html = renderInkloomEmailLayout({
    preheader: 'Your InkloomGuard AI password was recently changed.',
    heading: 'Password Changed Confirmation',
    greetingName: params.name,
    bodyHtml,
    footnote:
      'If you did not authorize this change, please reset your password immediately using Forgot Password and notify your workspace reviewer.',
  });

  const text = [
    'InkloomGuard AI — Check. Correct. Comply.',
    '',
    `Hello ${params.name},`,
    '',
    `Your InkloomGuard AI account password (${params.companyName}) was changed on ${new Date(params.changedAtIso).toUTCString()}.`,
    'All other active sessions have been signed out.',
    '',
    'If you did not make this change, reset your password immediately.',
  ].join('\n');

  await sendEmail({
    to: params.to,
    subject: 'Your password was changed — InkloomGuard AI',
    html,
    text,
  });
}
