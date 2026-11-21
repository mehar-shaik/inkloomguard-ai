export const BREVO_API_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
export const BREVO_TIMEOUT_MS = 12_000;
export const DEFAULT_BREVO_SENDER_NAME = 'InkloomGuard AI';

export type EmailKind = 'verification' | 'password-reset' | 'password-changed';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  emailType?: EmailKind;
}

export interface EmailSendResult {
  messageId?: string;
}

export interface EmailConfigStatus {
  configured: boolean;
  missing: string[];
  error?: string;
}

export interface EmailDiagnostics {
  configured: boolean;
  provider: 'brevo-https';
  endpoint: string;
  apiKeyConfigured: boolean;
  senderEmailConfigured: boolean;
  senderName: string;
  missing: string[];
  error?: string;
}

export type EmailSenderFn = (message: EmailMessage) => Promise<void | EmailSendResult>;
export type FetchFn = typeof fetch;

let testEmailSender: EmailSenderFn | null = null;
let testFetch: FetchFn | null = null;

export function setEmailSenderForTesting(sender: EmailSenderFn | null): void {
  testEmailSender = sender;
}

export function setFetchForTesting(fetchImpl: FetchFn | null): void {
  testFetch = fetchImpl;
}

export function resetEmailSenderForTesting(): void {
  testEmailSender = null;
  testFetch = null;
}

function isPlaceholderValue(value: string): boolean {
  return (
    /^REPLACE_WITH_/i.test(value) ||
    /^YOUR_/i.test(value) ||
    /^MY_/i.test(value) ||
    /^CHANGE_ME/i.test(value)
  );
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getEmailSettings() {
  const apiKey = stripOptionalQuotes(process.env.BREVO_API_KEY ?? '');
  const senderEmail = stripOptionalQuotes(process.env.BREVO_SENDER_EMAIL ?? '');
  const rawSenderName = stripOptionalQuotes(process.env.BREVO_SENDER_NAME ?? '');
  const senderName =
    rawSenderName && !isPlaceholderValue(rawSenderName) ? rawSenderName : DEFAULT_BREVO_SENDER_NAME;

  return { apiKey, senderEmail, senderName };
}

export function validateEmailConfig(): EmailConfigStatus {
  if (testEmailSender) {
    return { configured: true, missing: [] };
  }

  const { apiKey, senderEmail } = getEmailSettings();
  const missing: string[] = [];

  if (!apiKey || isPlaceholderValue(apiKey)) {
    missing.push('BREVO_API_KEY');
  }
  if (!senderEmail || isPlaceholderValue(senderEmail) || !isValidEmailAddress(senderEmail)) {
    missing.push('BREVO_SENDER_EMAIL');
  }

  if (missing.length > 0) {
    return {
      configured: false,
      missing,
      error: `Missing or invalid Brevo email environment variables: ${missing.join(', ')}.`,
    };
  }

  return {
    configured: true,
    missing: [],
  };
}

export function isEmailConfigured(): boolean {
  return validateEmailConfig().configured;
}

export function getEmailDiagnostics(): EmailDiagnostics {
  const { apiKey, senderEmail, senderName } = getEmailSettings();
  const status = validateEmailConfig();

  return {
    configured: status.configured,
    provider: 'brevo-https',
    endpoint: BREVO_API_ENDPOINT,
    apiKeyConfigured: Boolean(apiKey && !isPlaceholderValue(apiKey)),
    senderEmailConfigured: Boolean(
      senderEmail && !isPlaceholderValue(senderEmail) && isValidEmailAddress(senderEmail)
    ),
    senderName,
    missing: status.missing,
    error: status.error,
  };
}

export function logEmailStartupDiagnostics(): void {
  const diag = getEmailDiagnostics();
  const baseUrl = resolveAppBaseUrl();
  if (diag.configured) {
    console.log(
      `[InkloomGuard AI] Email delivery ready: provider=${diag.provider}, endpoint=${diag.endpoint}, appBaseUrl=${baseUrl}`
    );
  } else {
    console.warn(
      `[InkloomGuard AI] Email delivery inactive (provider=${diag.provider}, appBaseUrl=${baseUrl}): ${diag.error}`
    );
  }
}

export function redactEmailSecrets(text: string): string {
  const { apiKey, senderEmail } = getEmailSettings();
  let sanitized = String(text || '');

  if (apiKey) {
    sanitized = sanitized.split(apiKey).join('[REDACTED]');
  }
  if (senderEmail) {
    sanitized = sanitized.split(senderEmail).join('[REDACTED_SENDER]');
  }

  sanitized = sanitized.replace(/xkeysib-[A-Za-z0-9._-]+/gi, '[REDACTED_BREVO_KEY]');
  sanitized = sanitized.replace(/(api-key\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]');
  sanitized = sanitized.replace(/(Bearer\s+)([^\s,;]+)/gi, '$1[REDACTED]');
  return sanitized;
}

export function formatBrevoApiError(err: unknown): string {
  const errObj = (err && typeof err === 'object' ? err : {}) as {
    status?: unknown;
    code?: unknown;
    name?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  const status = typeof errObj.status === 'number' ? errObj.status : null;
  const causeObj = (errObj.cause && typeof errObj.cause === 'object' ? errObj.cause : {}) as {
    code?: unknown;
  };
  const code =
    typeof errObj.code === 'string'
      ? errObj.code
      : typeof causeObj.code === 'string'
        ? causeObj.code
        : '';
  const name = typeof errObj.name === 'string' ? errObj.name : err instanceof Error ? err.name : '';
  const rawMessage = redactEmailSecrets(
    err instanceof Error
      ? err.message
      : typeof errObj.message === 'string'
        ? errObj.message
        : String(err || 'Unknown Brevo email delivery error')
  );

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    /timed?\s*out|aborted due to timeout|ETIMEDOUT/i.test(rawMessage)
  ) {
    return 'Email delivery request to Brevo timed out. Please try again in a moment.';
  }

  if (status === 401 || status === 403) {
    return `Brevo API authentication or authorization failed (HTTP ${status}). Verify server-side BREVO_API_KEY and sender permissions.`;
  }

  if (status === 400) {
    return 'Brevo rejected the email payload (HTTP 400). Verify BREVO_SENDER_EMAIL is an authorized sender and the recipient address is valid.';
  }

  if (status === 404) {
    return 'Brevo transactional email endpoint was not found (HTTP 404). Verify the Brevo API configuration.';
  }

  if (status === 429) {
    return 'Brevo email rate limit or sending quota exceeded (HTTP 429). Please retry shortly.';
  }

  if (status !== null && status >= 500) {
    return `Brevo email service is temporarily unavailable (HTTP ${status}). Please try again later.`;
  }

  if (status !== null && status >= 400) {
    return `Brevo email delivery failed with HTTP ${status}.`;
  }

  if (
    err instanceof SyntaxError ||
    /invalid json|unexpected token|unexpected response payload/i.test(rawMessage)
  ) {
    return 'Brevo returned an invalid or unexpected JSON response. Please verify email delivery configuration.';
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    /fetch failed|network error|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET/i.test(rawMessage)
  ) {
    return `Unable to reach Brevo email API over HTTPS (${code || 'network error'}). Check outbound HTTPS connectivity and try again.`;
  }

  return `Brevo email delivery error: ${rawMessage.slice(0, 240)}`;
}

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);
  }
}

export function resolveAppBaseUrl(requestOrigin?: string): string {
  const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  const rawAppBaseUrl = stripOptionalQuotes(process.env.APP_BASE_URL ?? '');
  const rawAppUrl = stripOptionalQuotes(process.env.APP_URL ?? '');
  const rawRenderExternalUrl = stripOptionalQuotes(process.env.RENDER_EXTERNAL_URL ?? '');
  const appBaseUrl = isPlaceholderValue(rawAppBaseUrl) ? '' : rawAppBaseUrl;
  const appUrl = isPlaceholderValue(rawAppUrl) ? '' : rawAppUrl;
  const renderExternalUrl = isPlaceholderValue(rawRenderExternalUrl) ? '' : rawRenderExternalUrl;
  const reqOrigin = requestOrigin ? requestOrigin.trim() : '';

  const candidates = [appBaseUrl, appUrl, renderExternalUrl, reqOrigin].filter(Boolean);
  let chosen = '';
  if (isProd) {
    chosen = candidates.find((c) => !isLocalhostUrl(c)) || candidates[0] || '';
  } else {
    chosen = candidates[0] || '';
  }

  const fallback = chosen || 'http://localhost:3000';
  return fallback.replace(/\/+$/, '');
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

export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  const recipientEmail = String(message.to || '').trim();
  if (!recipientEmail || !isValidEmailAddress(recipientEmail)) {
    throw new Error('Recipient email address is invalid.');
  }

  const normalizedMessage: EmailMessage = {
    ...message,
    to: recipientEmail,
  };

  if (testEmailSender) {
    const result = await testEmailSender(normalizedMessage);
    return result && typeof result === 'object' ? result : {};
  }

  const validation = validateEmailConfig();
  if (!validation.configured) {
    throw new Error(
      validation.error || `Email service is not configured. Missing: ${validation.missing.join(', ')}.`
    );
  }

  const { apiKey, senderEmail, senderName } = getEmailSettings();
  const fetchImpl = testFetch || fetch;
  const emailType = normalizedMessage.emailType || 'transactional';

  const payload: Record<string, unknown> = {
    sender: {
      name: senderName,
      email: senderEmail,
    },
    to: [{ email: recipientEmail }],
    subject: normalizedMessage.subject,
    htmlContent: normalizedMessage.html,
    textContent: normalizedMessage.text,
  };
  if (normalizedMessage.emailType) {
    payload.tags = [normalizedMessage.emailType];
  }

  let response: Response;
  try {
    response = await fetchImpl(BREVO_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
  } catch (err) {
    const formatted = formatBrevoApiError(err);
    console.error(`[InkloomGuard AI] Brevo email network/timeout error (type=${emailType}): ${formatted}`);
    throw new Error(formatted);
  }

  let rawBody = '';
  try {
    rawBody = await response.text();
  } catch (err) {
    if (!response.ok) {
      const formatted = formatBrevoApiError({ status: response.status });
      console.error(`[InkloomGuard AI] Brevo email error (type=${emailType}, status=${response.status}): ${formatted}`);
      throw new Error(formatted);
    }
    const formatted = formatBrevoApiError(err);
    console.error(`[InkloomGuard AI] Brevo email body read error (type=${emailType}): ${formatted}`);
    throw new Error(formatted);
  }

  if (!response.ok) {
    const formatted = formatBrevoApiError({ status: response.status, message: rawBody });
    console.error(`[InkloomGuard AI] Brevo email rejected (type=${emailType}, status=${response.status}): ${formatted}`);
    throw new Error(formatted);
  }

  const trimmed = rawBody.trim();
  if (!trimmed) {
    console.log(
      `[InkloomGuard AI] Brevo email accepted (type=${emailType}, status=${response.status}, messageId=none)`
    );
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const formatted = formatBrevoApiError(err);
    console.error(`[InkloomGuard AI] Brevo email response parse error (type=${emailType}): ${formatted}`);
    throw new Error(formatted);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const formatted = formatBrevoApiError({ message: 'Unexpected response payload shape from Brevo' });
    console.error(`[InkloomGuard AI] Brevo email response shape error (type=${emailType}): ${formatted}`);
    throw new Error(formatted);
  }

  const data = parsed as { messageId?: unknown; messageIds?: unknown };
  const messageId =
    typeof data.messageId === 'string' && data.messageId.trim()
      ? data.messageId.trim()
      : Array.isArray(data.messageIds) && typeof data.messageIds[0] === 'string' && data.messageIds[0].trim()
        ? data.messageIds[0].trim()
        : undefined;

  console.log(
    `[InkloomGuard AI] Brevo email accepted (type=${emailType}, status=${response.status}, messageId=${messageId || 'none'})`
  );

  return messageId ? { messageId } : {};
}

export async function sendVerificationEmail(params: {
  to: string;
  name: string;
  companyName: string;
  verificationUrl: string;
  expiresHours: number;
}): Promise<EmailSendResult> {
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

  return await sendEmail({
    to: params.to,
    subject: 'Verify your email address — InkloomGuard AI',
    html,
    text,
    emailType: 'verification',
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
  expiresMinutes: number;
}): Promise<EmailSendResult> {
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

  return await sendEmail({
    to: params.to,
    subject: 'Reset your password — InkloomGuard AI',
    html,
    text,
    emailType: 'password-reset',
  });
}

export async function sendPasswordChangedEmail(params: {
  to: string;
  name: string;
  companyName: string;
  changedAtIso: string;
}): Promise<EmailSendResult> {
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

  return await sendEmail({
    to: params.to,
    subject: 'Your password was changed — InkloomGuard AI',
    html,
    text,
    emailType: 'password-changed',
  });
}
