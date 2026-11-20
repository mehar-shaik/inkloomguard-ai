import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { ApiError, api } from '../api';
import { ThemeToggle } from '../components/ClayUI';
import shieldEmblem from '/src/assets/images/inkloom_shield_emblem_1794725371250.jpg';

export function VerifyEmailPage({
  token,
  isAuthenticated,
  userEmail,
  userEmailVerified,
  initialEmail,
  theme,
  onToggleTheme,
  onVerifiedRefresh,
  onBackToApp,
}: {
  token: string;
  isAuthenticated: boolean;
  userEmail?: string;
  userEmailVerified?: boolean;
  initialEmail?: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onVerifiedRefresh?: () => Promise<void>;
  onBackToApp: () => void;
}) {
  const [verifying, setVerifying] = useState(Boolean(token.trim()));
  const [status, setStatus] = useState<'idle' | 'verified' | 'already_verified' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  const defaultEmail = initialEmail?.trim() || (!userEmailVerified ? userEmail || '' : '');
  const [resendEmail, setResendEmail] = useState(defaultEmail);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');

  const lastVerifiedTokenRef = useRef<string>('');

  useEffect(() => {
    const cleanToken = token.trim();
    if (!cleanToken) {
      setVerifying(false);
      setStatus('idle');
      return;
    }

    if (lastVerifiedTokenRef.current === cleanToken) {
      return;
    }
    lastVerifiedTokenRef.current = cleanToken;

    let active = true;
    setVerifying(true);
    setStatus('idle');
    setStatusMessage('');

    api
      .verifyEmail(cleanToken)
      .then(async (res) => {
        if (!active) return;
        setStatus('verified');
        setStatusMessage(res.message || 'Your email address has been verified.');
        if (isAuthenticated && onVerifiedRefresh) {
          await onVerifiedRefresh().catch(() => {});
        }
      })
      .catch(async (err) => {
        if (!active) return;
        if (err instanceof ApiError && err.reason === 'already_verified') {
          setStatus('already_verified');
          setStatusMessage(err.message || 'This email address has already been verified.');
          if (isAuthenticated && onVerifiedRefresh) {
            await onVerifiedRefresh().catch(() => {});
          }
          return;
        }
        setStatus('error');
        setStatusMessage(
          err instanceof Error ? err.message : 'This email verification link is invalid or expired.'
        );
      })
      .finally(() => {
        if (active) setVerifying(false);
      });

    return () => {
      active = false;
    };
  }, [token, isAuthenticated, onVerifiedRefresh]);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    setResendMessage('');
    setResendError('');

    const enteredEmail = resendEmail.trim();
    if (!enteredEmail && !isAuthenticated) {
      setResendError('Please enter your account email address.');
      return;
    }

    setResending(true);
    try {
      const sameAsAuthed =
        isAuthenticated &&
        Boolean(userEmail) &&
        enteredEmail.toLowerCase() === String(userEmail).trim().toLowerCase();

      const res = await api.resendVerification(
        isAuthenticated && (!enteredEmail || sameAsAuthed) ? undefined : enteredEmail
      );
      setResendMessage(res.message);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Unable to resend verification email.');
    } finally {
      setResending(false);
    }
  }

  const isSuccessOutcome = status === 'verified' || status === 'already_verified';

  return (
    <div className="min-h-screen flex flex-col justify-between p-4 sm:p-8 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-28 -left-28 w-96 h-96 rounded-full bg-indigo-300/30 dark:bg-violet-700/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -bottom-32 -right-24 w-[28rem] h-[28rem] rounded-full bg-violet-300/25 dark:bg-sky-600/15 blur-3xl"
      />

      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4 relative z-10">
        <div className="flex items-center gap-3">
          <img
            src={shieldEmblem}
            alt="InkloomGuard AI Shield"
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-2xl object-cover shadow-md border border-white/80 dark:border-violet-400/30"
          />
          <span className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
            InkloomGuard AI
          </span>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>

      <main className="max-w-md w-full mx-auto my-8 relative z-10">
        <section className="clay-surface rounded-[28px] p-8 sm:p-9 space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300">
              Email Verification
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Verify your account email
            </h1>
          </div>

          {verifying && (
            <div className="clay-well rounded-2xl p-5 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-violet-300 shrink-0" />
              <span>Validating your verification link...</span>
            </div>
          )}

          {!verifying && isSuccessOutcome && (
            <div className="space-y-5">
              <div
                role="status"
                className="clay-well rounded-2xl p-4 flex items-start gap-3 border border-emerald-200/80 dark:border-emerald-400/30"
              >
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs leading-relaxed">
                  <p className="font-bold text-slate-900 dark:text-white">
                    {status === 'already_verified' ? 'Email Already Verified' : 'Verification Complete'}
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">{statusMessage}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onBackToApp}
                className="clay-btn-primary w-full rounded-full py-3.5 px-6 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                {isAuthenticated ? 'Continue to Workspace' : 'Continue to Sign In'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {!verifying && status === 'error' && (
            <div
              role="alert"
              className="clay-well rounded-2xl p-4 flex items-start gap-3 border border-red-200 dark:border-rose-400/30"
            >
              <ShieldAlert className="w-5 h-5 text-red-600 dark:text-rose-300 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs leading-relaxed">
                <p className="font-bold text-red-900 dark:text-rose-200">Verification Link Issue</p>
                <p className="text-red-800 dark:text-rose-200/90">{statusMessage}</p>
              </div>
            </div>
          )}

          {!verifying && !isSuccessOutcome && (
            <form onSubmit={handleResend} className="space-y-4 pt-2 border-t border-slate-200/70 dark:border-violet-400/20">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 leading-relaxed">
                Need a fresh verification link? Enter your account email below to send a new 24-hour verification link. Check your inbox and spam folder after sending.
              </p>

              <div>
                <label
                  htmlFor="resend-verify-email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  Account Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="resend-verify-email"
                    type="email"
                    required={!isAuthenticated || Boolean(userEmailVerified)}
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    placeholder={userEmail || 'name@company.com'}
                    className="clay-well w-full rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>
              </div>

              {resendMessage && (
                <div
                  role="status"
                  className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30"
                >
                  {resendMessage}
                </div>
              )}

              {resendError && (
                <div
                  role="alert"
                  className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
                >
                  {resendError}
                </div>
              )}

              <button
                type="submit"
                disabled={resending}
                className="clay-btn-primary w-full rounded-full py-3 px-6 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-4 h-4" />
                {resending ? 'Sending Verification Email...' : 'Resend Verification Email'}
              </button>

              <button
                type="button"
                onClick={onBackToApp}
                className="clay-btn-secondary w-full rounded-full py-2.5 px-5 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {isAuthenticated ? 'Back to Workspace' : 'Back to Sign In'}
              </button>
            </form>
          )}
        </section>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 dark:text-slate-400 relative z-10">
        InkloomGuard AI · Check. Correct. Comply.
      </footer>
    </div>
  );
}
