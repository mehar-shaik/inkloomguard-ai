import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldAlert, Loader2 } from 'lucide-react';
import { api } from '../api';
import { ThemeToggle } from '../components/ClayUI';
import { PasswordField } from '../components/PasswordField';
import { evaluatePasswordStrength } from '../utils/password';
import shieldEmblem from '/src/assets/images/inkloom_shield_emblem_1794725371250.jpg';

export function ResetPasswordPage({
  token,
  theme,
  onToggleTheme,
  onBackToLogin,
  onGoForgotPassword,
}: {
  token: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onBackToLogin: () => void;
  onGoForgotPassword: () => void;
}) {
  const [checkingToken, setCheckingToken] = useState(true);
  const [tokenError, setTokenError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let active = true;
    setCheckingToken(true);
    setTokenError('');

    if (!token.trim()) {
      setTokenError('No password reset token was found in this link.');
      setCheckingToken(false);
      return;
    }

    api
      .validateResetToken(token)
      .then((res) => {
        if (!active) return;
        if (!res.valid) {
          setTokenError(res.error || 'This password reset link is invalid or has expired.');
        }
      })
      .catch((err) => {
        if (!active) return;
        setTokenError(
          err instanceof Error ? err.message : 'This password reset link is invalid or has expired.'
        );
      })
      .finally(() => {
        if (active) setCheckingToken(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const strength = evaluatePasswordStrength(newPassword);
    if (!strength.isValid) {
      setError(`Please choose a stronger password: ${strength.errors.join(', ')}.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Password confirmation does not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.resetPassword({ token, newPassword, confirmPassword });
      setSuccessMessage(
        res.message || 'Your password has been reset successfully. You can now sign in.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setSubmitting(false);
    }
  }

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
              Password Security
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Set a new password
            </h1>
          </div>

          {checkingToken ? (
            <div className="clay-well rounded-2xl p-6 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-violet-300 shrink-0" />
              <span>Verifying reset link authenticity and expiry...</span>
            </div>
          ) : successMessage ? (
            <div className="space-y-5">
              <div
                role="status"
                className="clay-well rounded-2xl p-4 flex items-start gap-3 border border-emerald-200/80 dark:border-emerald-400/30"
              >
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs leading-relaxed">
                  <p className="font-bold text-slate-900 dark:text-white">Password Updated</p>
                  <p className="text-slate-600 dark:text-slate-300">{successMessage}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onBackToLogin}
                className="clay-btn-primary w-full rounded-full py-3.5 px-6 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                Sign In with New Password
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : tokenError ? (
            <div className="space-y-4">
              <div
                role="alert"
                className="clay-well rounded-2xl p-4 flex items-start gap-3 border border-red-200 dark:border-rose-400/30"
              >
                <ShieldAlert className="w-5 h-5 text-red-600 dark:text-rose-300 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs leading-relaxed">
                  <p className="font-bold text-red-900 dark:text-rose-200">Reset Link Unavailable</p>
                  <p className="text-red-800 dark:text-rose-200/90">{tokenError}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onGoForgotPassword}
                className="clay-btn-primary w-full rounded-full py-3 px-6 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                Request a New Reset Link
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onBackToLogin}
                className="clay-btn-secondary w-full rounded-full py-2.5 px-5 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <PasswordField
                id="reset-new-password"
                label="New Password"
                value={newPassword}
                onChange={setNewPassword}
                placeholder="Create a strong password"
                autoComplete="new-password"
                showStrength
                disabled={submitting}
              />

              <PasswordField
                id="reset-confirm-password"
                label="Confirm New Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                disabled={submitting}
              />

              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Passwords do not match yet.
                </p>
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="clay-btn-primary w-full rounded-full py-3.5 px-6 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {submitting ? 'Updating Password...' : 'Reset Password'}
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onBackToLogin}
                className="clay-btn-secondary w-full rounded-full py-2.5 px-5 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Sign In
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
