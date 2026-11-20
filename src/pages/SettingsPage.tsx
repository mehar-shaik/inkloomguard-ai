import React, { useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  LogOut,
  MailCheck,
  MailWarning,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { api, setAuthToken } from '../api';
import type { AuthUser } from '../types';
import { formatDateTime } from '../utils/date';
import { evaluatePasswordStrength } from '../utils/password';
import { PasswordField } from '../components/PasswordField';
import { ConfirmModal } from '../components/ConfirmModal';
import { ThemeToggle } from '../components/ClayUI';

export function SettingsPage({
  user,
  theme,
  onToggleTheme,
  onUserUpdated,
  onSignedOutAll,
}: {
  user: AuthUser;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onUserUpdated: (user: AuthUser) => void;
  onSignedOutAll: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [resendingVerify, setResendingVerify] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState('');
  const [verifyError, setVerifyError] = useState('');

  const [confirmLogoutAllOpen, setConfirmLogoutAllOpen] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [sessionError, setSessionError] = useState('');

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError('New password must be different from your current password.');
      return;
    }
    const strength = evaluatePasswordStrength(newPassword);
    if (!strength.isValid) {
      setPasswordError(`Please choose a stronger password: ${strength.errors.join(', ')}.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await api.changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      if (res.token) {
        setAuthToken(res.token);
      }
      onUserUpdated(res.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess(
        res.message || 'Password updated successfully. All other active sessions have been signed out.'
      );
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleResendVerification() {
    setVerifyNotice('');
    setVerifyError('');
    setResendingVerify(true);
    try {
      const res = await api.resendVerification();
      setVerifyNotice(res.message);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Unable to send verification email.');
    } finally {
      setResendingVerify(false);
    }
  }

  async function handleLogoutAllDevices() {
    setSessionError('');
    setLoggingOutAll(true);
    try {
      await api.logoutAll();
      setConfirmLogoutAllOpen(false);
      onSignedOutAll();
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : 'Unable to sign out active sessions.');
      setConfirmLogoutAllOpen(false);
    } finally {
      setLoggingOutAll(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Account & Email Verification Status */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
              <ShieldCheck className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Account &amp; Security</span>
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              Workspace Account Overview
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Manage your email verification status, password credentials, and active sessions.
            </p>
          </div>

          {user.emailVerified ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/35">
              <MailCheck className="w-4 h-4" />
              Email Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200/80 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/35">
              <MailWarning className="w-4 h-4" />
              Email Unverified
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="clay-well rounded-2xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Account Holder</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate">{user.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{user.email}</p>
          </div>

          <div className="clay-well rounded-2xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Organization &amp; Role</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate">{user.companyName}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 capitalize mt-0.5">{user.role}</p>
          </div>

          <div className="clay-well rounded-2xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Security Activity</p>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-1">
              {user.emailVerified
                ? `Verified ${formatDateTime(user.emailVerifiedAt)}`
                : 'Verification pending'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {user.passwordUpdatedAt
                ? `Password updated ${formatDateTime(user.passwordUpdatedAt)}`
                : 'Initial account password active'}
            </p>
          </div>
        </div>

        {!user.emailVerified && (
          <div className="clay-well rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-amber-200/80 dark:border-amber-400/30">
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                Verify your email address
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Confirm ownership of <span className="font-semibold">{user.email}</span> to enable full recovery and security confirmations.
              </p>
            </div>
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={resendingVerify}
              className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-60"
            >
              <Send className="w-3.5 h-3.5" />
              {resendingVerify ? 'Sending...' : 'Resend Verification Email'}
            </button>
          </div>
        )}

        {verifyNotice && (
          <div
            role="status"
            className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30"
          >
            {verifyNotice}
          </div>
        )}

        {verifyError && (
          <div
            role="alert"
            className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
          >
            {verifyError}
          </div>
        )}
      </section>

      {/* Change Password */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
            <KeyRound className="w-5 h-5" />
            <span className="text-xs font-bold uppercase tracking-wider">Credentials</span>
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Change Password</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Updating your password rotates your session token and automatically signs out all other active devices.
          </p>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4 max-w-xl">
          <PasswordField
            id="settings-current-password"
            label="Current Password"
            value={currentPassword}
            onChange={setCurrentPassword}
            placeholder="Enter your current password"
            autoComplete="current-password"
            disabled={changingPassword}
          />

          <PasswordField
            id="settings-new-password"
            label="New Password"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="Create a strong new password"
            autoComplete="new-password"
            showStrength
            disabled={changingPassword}
          />

          <PasswordField
            id="settings-confirm-password"
            label="Confirm New Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Re-enter your new password"
            autoComplete="new-password"
            disabled={changingPassword}
          />

          {confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              New password confirmation does not match.
            </p>
          )}

          {passwordError && (
            <div
              role="alert"
              className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
            >
              {passwordError}
            </div>
          )}

          {passwordSuccess && (
            <div
              role="status"
              className="rounded-2xl px-4 py-3 text-xs font-semibold flex items-center gap-2 bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{passwordSuccess}</span>
            </div>
          )}

          <div className="pt-1">
            <button
              type="submit"
              disabled={changingPassword}
              className="clay-btn-primary rounded-full px-6 py-3 text-sm font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <KeyRound className="w-4 h-4" />
              {changingPassword ? 'Updating Password...' : 'Update Password'}
            </button>
          </div>
        </form>
      </section>

      {/* Session Security & Theme */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200/70 dark:border-violet-400/20">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Appearance</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Switch between Light Clay and Dark Clay workspace themes.
            </p>
          </div>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              Invalidate All Active Sessions
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Immediately revoke all issued session tokens across every browser and device.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmLogoutAllOpen(true)}
            className="clay-btn-secondary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 text-red-700 dark:text-rose-300 shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out All Sessions
          </button>
        </div>

        {sessionError && (
          <div
            role="alert"
            className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
          >
            {sessionError}
          </div>
        )}
      </section>

      <ConfirmModal
        open={confirmLogoutAllOpen}
        title="Sign Out All Active Sessions"
        message="This will immediately invalidate every active session for your account, including this browser. You will need to sign in again."
        confirmLabel="Sign Out All Sessions"
        variant="danger"
        loading={loggingOutAll}
        onConfirm={handleLogoutAllDevices}
        onCancel={() => setConfirmLogoutAllOpen(false)}
      />
    </div>
  );
}
