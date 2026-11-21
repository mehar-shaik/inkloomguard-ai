import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  MailCheck,
  MailWarning,
  Settings,
  ShieldCheck,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { api, evictProtectedAssetCache } from '../api';
import type { AuthUser, PageKey, SettingsSection } from '../types';
import { formatDateTime } from '../utils/date';
import { getRolePermissionDetails } from '../utils/roles';
import { UserAvatar } from '../components/UserAvatar';
import { AvatarEditorModal } from '../components/AvatarEditorModal';

export function ProfilePage({
  user,
  onNavigate,
  onNavigateSettings,
  onUserUpdated,
}: {
  user: AuthUser;
  onNavigate: (page: PageKey) => void;
  onNavigateSettings: (section: SettingsSection) => void;
  onUserUpdated: (updated: AuthUser) => void;
}) {
  const roleDetails = getRolePermissionDetails(user.role);

  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState('');
  const [avatarError, setAvatarError] = useState('');

  const [name, setName] = useState(user.name);
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileStatus, setProfileStatus] = useState('');
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    setName(user.name);
    setJobTitle(user.jobTitle ?? '');
    setBio(user.bio ?? '');
  }, [user.name, user.jobTitle, user.bio]);

  const hasUnsavedChanges =
    name.trim() !== user.name ||
    jobTitle.trim() !== (user.jobTitle ?? '').trim() ||
    bio.trim() !== (user.bio ?? '').trim();

  async function handleSaveAvatar(croppedBlob: Blob, filename: string) {
    setAvatarError('');
    setAvatarStatus('');
    const previousFilename = user.avatarFilename;
    const res = await api.uploadAvatar(croppedBlob, filename);
    if (previousFilename && previousFilename !== res.user.avatarFilename) {
      evictProtectedAssetCache(previousFilename);
    }
    onUserUpdated(res.user);
    setAvatarStatus('Profile picture updated across your workspace.');
  }

  async function handleRemoveAvatar() {
    if (!user.avatarFilename || removingAvatar) return;
    setRemovingAvatar(true);
    setAvatarError('');
    setAvatarStatus('');
    const previousFilename = user.avatarFilename;
    try {
      const res = await api.deleteAvatar();
      evictProtectedAssetCache(previousFilename);
      onUserUpdated(res.user);
      setAvatarStatus('Profile picture removed. Default initials avatar restored.');
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Unable to remove profile picture.');
    } finally {
      setRemovingAvatar(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError('');
    setProfileStatus('');

    const cleanName = name.trim();
    const cleanJobTitle = jobTitle.trim();
    const cleanBio = bio.trim();

    if (!cleanName || cleanName.length > 120) {
      setProfileError('Display name must be between 1 and 120 characters.');
      return;
    }
    if (cleanJobTitle.length > 120) {
      setProfileError('Job title cannot exceed 120 characters.');
      return;
    }
    if (cleanBio.length > 500) {
      setProfileError('Bio cannot exceed 500 characters.');
      return;
    }

    setSavingProfile(true);
    try {
      const res = await api.updateProfile({
        name: cleanName,
        jobTitle: cleanJobTitle,
        bio: cleanBio,
      });
      onUserUpdated(res.user);
      setProfileStatus('Profile details saved.');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Unable to save profile details.');
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Identity Overview Card */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 min-w-0">
            <UserAvatar user={user} size="lg" className="rounded-full" />
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-indigo-600 dark:text-violet-300">
                <span>{roleDetails.label}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{user.companyName}</span>
                {user.jobTitle && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate text-slate-600 dark:text-slate-300">{user.jobTitle}</span>
                  </>
                )}
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
                {user.name}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 truncate">{user.email}</p>

              <div className="flex flex-wrap items-center gap-2 pt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setAvatarError('');
                    setAvatarStatus('');
                    setAvatarModalOpen(true);
                  }}
                  className="clay-btn-primary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {user.avatarFilename ? 'Change Picture' : 'Upload Picture'}
                </button>
                {user.avatarFilename && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={removingAvatar}
                    className="clay-btn-secondary rounded-full px-3.5 py-2 text-xs font-bold text-red-700 dark:text-rose-300 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400"
                  >
                    {removingAvatar ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    Remove Picture
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0 self-start md:self-center">
            <button
              type="button"
              onClick={() => onNavigateSettings('account')}
              className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400"
            >
              <Settings className="w-3.5 h-3.5" />
              Account Settings
            </button>
            <button
              type="button"
              onClick={() => onNavigateSettings('security')}
              className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Security
            </button>
          </div>
        </div>

        {avatarStatus && (
          <div
            role="status"
            className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{avatarStatus}</span>
          </div>
        )}

        {avatarError && (
          <div
            role="alert"
            className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{avatarError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="clay-well rounded-2xl p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5" />
              Display Name
            </p>
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {user.jobTitle || user.email}
            </p>
          </div>

          <div className="clay-well rounded-2xl p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              Organization &amp; Role
            </p>
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {user.companyName}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {roleDetails.label} ({roleDetails.subtitle})
            </p>
          </div>

          <div className="clay-well rounded-2xl p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              Account Verification
            </p>
            <p
              className={`text-xs font-bold inline-flex items-center gap-1.5 ${
                user.emailVerified
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300'
              }`}
            >
              {user.emailVerified ? (
                <>
                  <MailCheck className="w-3.5 h-3.5" />
                  Verified {user.emailVerifiedAt ? formatDateTime(user.emailVerifiedAt) : ''}
                </>
              ) : (
                <>
                  <MailWarning className="w-3.5 h-3.5" />
                  Verification pending
                </>
              )}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {user.passwordUpdatedAt
                ? `Password updated ${formatDateTime(user.passwordUpdatedAt)}`
                : 'Initial account credentials active'}
            </p>
          </div>
        </div>
      </section>

      {/* Editable Profile Details */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300">
            Personal Information
          </p>
          <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
            Edit Profile Details
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Update your display name, role title, and short bio. Role permissions remain server-controlled.
          </p>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Display Name
              </span>
              <input
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setProfileStatus('');
                  setProfileError('');
                }}
                placeholder="Your full name"
                className="clay-well w-full rounded-2xl px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 dark:focus:ring-violet-400/60"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Job Title / Function
              </span>
              <input
                type="text"
                maxLength={120}
                value={jobTitle}
                onChange={(e) => {
                  setJobTitle(e.target.value);
                  setProfileStatus('');
                  setProfileError('');
                }}
                placeholder="e.g., Brand Compliance Lead"
                className="clay-well w-full rounded-2xl px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 dark:focus:ring-violet-400/60"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Bio</span>
              <span className="text-[11px] text-slate-400">{bio.length}/500</span>
            </div>
            <textarea
              rows={3}
              maxLength={500}
              value={bio}
              onChange={(e) => {
                setBio(e.target.value);
                setProfileStatus('');
                setProfileError('');
              }}
              placeholder="Add a brief summary of your brand governance responsibilities..."
              className="clay-well w-full rounded-2xl px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 dark:focus:ring-violet-400/60 resize-y"
            />
          </label>

          {/* Read-only server-controlled metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="clay-well rounded-2xl px-4 py-2.5 space-y-0.5 opacity-90">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Account Role (Read-only)
              </span>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {roleDetails.label}
              </p>
            </div>
            <div className="clay-well rounded-2xl px-4 py-2.5 space-y-0.5 opacity-90">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Registered Email (Read-only)
              </span>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                {user.email}
              </p>
            </div>
          </div>

          {profileStatus && (
            <div
              role="status"
              className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30 flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{profileStatus}</span>
            </div>
          )}

          {profileError && (
            <div
              role="alert"
              className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{profileError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={!hasUnsavedChanges || savingProfile}
              onClick={() => {
                setName(user.name);
                setJobTitle(user.jobTitle ?? '');
                setBio(user.bio ?? '');
                setProfileError('');
                setProfileStatus('');
              }}
              className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold cursor-pointer disabled:opacity-45"
            >
              Discard Changes
            </button>
            <button
              type="submit"
              disabled={!hasUnsavedChanges || savingProfile}
              className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-55"
            >
              {savingProfile ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Save Profile Changes
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Role Permissions Card */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300">
              Workspace Access Control
            </p>
            <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
              {roleDetails.label} Permissions
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Permissions are enforced server-side for your assigned organization role.
            </p>
          </div>

          {!user.verificationRequired || user.emailVerified ? (
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Dashboard
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigateSettings('account')}
              className="clay-btn-primary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              Verify Email in Settings
            </button>
          )}
        </div>

        <ul className="divide-y divide-slate-200/70 dark:divide-violet-400/15">
          {roleDetails.capabilities.map((cap) => (
            <li key={cap.label} className="py-3 flex items-center gap-3 text-sm">
              {cap.allowed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
              )}
              <span
                className={
                  cap.allowed
                    ? 'font-medium text-slate-800 dark:text-slate-100'
                    : 'text-slate-500 dark:text-slate-400'
                }
              >
                {cap.label}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <AvatarEditorModal
        open={avatarModalOpen}
        hasExistingAvatar={Boolean(user.avatarFilename)}
        onClose={() => setAvatarModalOpen(false)}
        onSave={handleSaveAvatar}
      />
    </div>
  );
}
