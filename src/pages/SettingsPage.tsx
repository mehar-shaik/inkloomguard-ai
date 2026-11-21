import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  MailCheck,
  MailWarning,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, evictProtectedAssetCache, setAuthToken } from '../api';
import type {
  AuthUser,
  DefaultLandingPage,
  OrganizationSummary,
  SettingsSection,
  TeamMemberSummary,
  UserPreferences,
  UserSessionInfo,
} from '../types';
import { formatDateTime } from '../utils/date';
import { evaluatePasswordStrength } from '../utils/password';
import { formatUserRoleLabel, getUserInitials } from '../utils/roles';
import { PasswordField } from '../components/PasswordField';
import { ConfirmModal } from '../components/ConfirmModal';
import { UserAvatar } from '../components/UserAvatar';
import { AvatarEditorModal } from '../components/AvatarEditorModal';

const SETTINGS_TABS: Array<{
  key: SettingsSection;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: 'account',
    label: 'Account Overview',
    description: 'Identity, role & verification',
    icon: UserCheck,
  },
  {
    key: 'profile',
    label: 'Profile',
    description: 'Photo, name & bio',
    icon: User,
  },
  {
    key: 'appearance',
    label: 'Appearance',
    description: 'Light & Dark Clay themes',
    icon: Palette,
  },
  {
    key: 'security',
    label: 'Security',
    description: 'Password & active sessions',
    icon: ShieldCheck,
  },
  {
    key: 'notifications',
    label: 'Notifications & Preferences',
    description: 'Alerts & workspace defaults',
    icon: Bell,
  },
  {
    key: 'organization',
    label: 'Organization / Workspace',
    description: 'Workspace details & team',
    icon: Building2,
  },
];

const DEFAULT_PREFERENCES: UserPreferences = {
  emailNotifications: true,
  reviewNotifications: true,
  complianceAnalysisNotifications: true,
  productAccountNotifications: true,
  defaultPage: 'dashboard',
  sidebarCollapsed: false,
  theme: 'light',
};

function getSectionButtonId(key: SettingsSection): string {
  return `settings-nav-${key}`;
}

export function SettingsPage({
  user,
  theme,
  sidebarCollapsed,
  activeSection,
  onSectionChange,
  onSelectTheme,
  onSetSidebarCollapsed,
  onUserUpdated,
  onRefreshUser,
  onLogout,
  onSignedOutAll,
}: {
  user: AuthUser;
  theme: 'light' | 'dark';
  sidebarCollapsed: boolean;
  activeSection?: SettingsSection | null;
  onSectionChange?: (section: SettingsSection) => void;
  onSelectTheme: (nextTheme: 'light' | 'dark') => void;
  onSetSidebarCollapsed: (collapsed: boolean) => void;
  onUserUpdated: (user: AuthUser) => void;
  onRefreshUser?: () => Promise<AuthUser | null>;
  onLogout: () => void;
  onSignedOutAll: () => void;
}) {
  const currentSection: SettingsSection = activeSection || 'account';
  const roleLabel = formatUserRoleLabel(user.role);
  const isAdmin = user.role === 'admin';
  const isReviewerOrAdmin = user.role === 'reviewer' || isAdmin;
  const needsVerification = Boolean(user.verificationRequired && !user.emailVerified);

  // ---------------- ACCOUNT OVERVIEW & VERIFICATION ----------------
  const [resendingVerify, setResendingVerify] = useState(false);
  const [refreshingVerify, setRefreshingVerify] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState('');
  const [verifyError, setVerifyError] = useState('');

  // ---------------- PROFILE SECTION ----------------
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [confirmRemoveAvatarOpen, setConfirmRemoveAvatarOpen] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState('');
  const [avatarError, setAvatarError] = useState('');

  const [profileName, setProfileName] = useState(user.name);
  const [profileJobTitle, setProfileJobTitle] = useState(user.jobTitle ?? '');
  const [profileBio, setProfileBio] = useState(user.bio ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileStatus, setProfileStatus] = useState('');
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    setProfileName(user.name);
    setProfileJobTitle(user.jobTitle ?? '');
    setProfileBio(user.bio ?? '');
  }, [user.name, user.jobTitle, user.bio]);

  const profileDirty =
    profileName.trim() !== user.name ||
    profileJobTitle.trim() !== (user.jobTitle ?? '').trim() ||
    profileBio.trim() !== (user.bio ?? '').trim();

  // ---------------- SECURITY SECTION ----------------
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [sessions, setSessions] = useState<UserSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionActionMessage, setSessionActionMessage] = useState('');
  const [revokingSessionId, setRevokingSessionId] = useState<number | null>(null);
  const [confirmRevokeOthersOpen, setConfirmRevokeOthersOpen] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [confirmLogoutAllOpen, setConfirmLogoutAllOpen] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  // ---------------- NOTIFICATIONS & PREFERENCES SECTION ----------------
  const [savedPrefs, setSavedPrefs] = useState<UserPreferences>(
    user.preferences ?? { ...DEFAULT_PREFERENCES, theme, sidebarCollapsed }
  );
  const [draftPrefs, setDraftPrefs] = useState<UserPreferences>(
    user.preferences ?? { ...DEFAULT_PREFERENCES, theme, sidebarCollapsed }
  );
  const [emailDeliveryConfigured, setEmailDeliveryConfigured] = useState<boolean | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const [prefsSuccess, setPrefsSuccess] = useState('');

  const prefsDirty =
    draftPrefs.emailNotifications !== savedPrefs.emailNotifications ||
    draftPrefs.reviewNotifications !== savedPrefs.reviewNotifications ||
    draftPrefs.complianceAnalysisNotifications !== savedPrefs.complianceAnalysisNotifications ||
    draftPrefs.productAccountNotifications !== savedPrefs.productAccountNotifications ||
    draftPrefs.defaultPage !== savedPrefs.defaultPage ||
    draftPrefs.sidebarCollapsed !== savedPrefs.sidebarCollapsed;

  // ---------------- ORGANIZATION / WORKSPACE SECTION ----------------
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [canManageWorkspace, setCanManageWorkspace] = useState(isReviewerOrAdmin);
  const [members, setMembers] = useState<TeamMemberSummary[]>([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgLoadError, setOrgLoadError] = useState('');

  const [orgNameDraft, setOrgNameDraft] = useState(user.companyName);
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgSaveError, setOrgSaveError] = useState('');
  const [orgSaveSuccess, setOrgSaveSuccess] = useState('');

  const [showAddMember, setShowAddMember] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberPassword, setMemberPassword] = useState('');
  const [memberRole, setMemberRole] = useState<'author' | 'reviewer' | 'admin'>('author');
  const [creatingMember, setCreatingMember] = useState(false);
  const [memberFormError, setMemberFormError] = useState('');
  const [memberFormSuccess, setMemberFormSuccess] = useState('');
  const [updatingMemberId, setUpdatingMemberId] = useState<number | null>(null);
  const [memberRoleError, setMemberRoleError] = useState('');
  const [memberRoleSuccess, setMemberRoleSuccess] = useState('');

  const orgDirty = Boolean(organization && orgNameDraft.trim() !== organization.name.trim());

  // ---------------- UNSAVED CHANGES GUARD ----------------
  const [pendingSectionSwitch, setPendingSectionSwitch] = useState<SettingsSection | null>(null);

  const isCurrentSectionDirty =
    (currentSection === 'profile' && profileDirty) ||
    (currentSection === 'notifications' && prefsDirty) ||
    (currentSection === 'organization' && orgDirty);

  const hasAnyUnsavedChanges = profileDirty || prefsDirty || orgDirty;

  useEffect(() => {
    if (!hasAnyUnsavedChanges) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasAnyUnsavedChanges]);

  function resetCurrentSectionDraft() {
    if (currentSection === 'profile') {
      setProfileName(user.name);
      setProfileJobTitle(user.jobTitle ?? '');
      setProfileBio(user.bio ?? '');
      setProfileError('');
      setProfileStatus('');
    } else if (currentSection === 'notifications') {
      setDraftPrefs(savedPrefs);
      setPrefsError('');
      setPrefsSuccess('');
    } else if (currentSection === 'organization' && organization) {
      setOrgNameDraft(organization.name);
      setOrgSaveError('');
      setOrgSaveSuccess('');
    }
  }

  function handleRequestSectionChange(next: SettingsSection) {
    if (next === currentSection) return;
    if (isCurrentSectionDirty) {
      setPendingSectionSwitch(next);
      return;
    }
    onSectionChange?.(next);
  }

  // ---------------- DATA LOADERS ----------------
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError('');
    try {
      const res = await api.getSessions();
      setSessions(res.sessions);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Unable to load active sessions.');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadPreferences = useCallback(async () => {
    setPrefsLoading(true);
    setPrefsError('');
    try {
      const res = await api.getPreferences();
      setSavedPrefs(res.preferences);
      setDraftPrefs(res.preferences);
      setEmailDeliveryConfigured(res.emailDeliveryConfigured);
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : 'Unable to load account preferences.');
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  const loadOrganizationData = useCallback(async () => {
    setOrgLoading(true);
    setOrgLoadError('');
    try {
      const orgRes = await api.getOrganization();
      setOrganization(orgRes.organization);
      setOrgNameDraft(orgRes.organization.name);
      setCanManageWorkspace(orgRes.canManageWorkspace);

      if (!needsVerification) {
        const teamRes = await api.getTeamMembers();
        setMembers(teamRes.members);
      } else {
        setMembers([]);
      }
    } catch (err) {
      setOrgLoadError(err instanceof Error ? err.message : 'Unable to load organization workspace.');
    } finally {
      setOrgLoading(false);
    }
  }, [needsVerification]);

  useEffect(() => {
    if (currentSection === 'security') {
      void loadSessions();
    } else if (currentSection === 'notifications') {
      void loadPreferences();
    } else if (currentSection === 'organization') {
      void loadOrganizationData();
    }
  }, [currentSection, loadSessions, loadPreferences, loadOrganizationData]);

  // ---------------- HANDLERS ----------------
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

  async function handleRefreshVerificationStatus() {
    if (!onRefreshUser) return;
    setVerifyNotice('');
    setVerifyError('');
    setRefreshingVerify(true);
    try {
      const latest = await onRefreshUser();
      if (latest?.emailVerified) {
        setVerifyNotice('Your email address is verified and workspace access is active.');
      } else {
        setVerifyNotice(
          'Email verification is still pending. Please check your inbox and spam folder, or resend the link.'
        );
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Unable to refresh verification status.');
    } finally {
      setRefreshingVerify(false);
    }
  }

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

  async function handleRemoveAvatarConfirmed() {
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
      setConfirmRemoveAvatarOpen(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError('');
    setProfileStatus('');

    const cleanName = profileName.trim();
    const cleanJobTitle = profileJobTitle.trim();
    const cleanBio = profileBio.trim();

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
      setProfileStatus('Profile information saved.');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Unable to save profile details.');
    } finally {
      setSavingProfile(false);
    }
  }

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
      void loadSessions();
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleRevokeSingleSession(sessionId: number) {
    setSessionsError('');
    setSessionActionMessage('');
    setRevokingSessionId(sessionId);
    try {
      const res = await api.revokeSession(sessionId);
      setSessions(res.sessions);
      setSessionActionMessage(res.message || 'Selected session has been signed out.');
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Unable to revoke session.');
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleRevokeOtherSessionsConfirmed() {
    setSessionsError('');
    setSessionActionMessage('');
    setRevokingOthers(true);
    try {
      const res = await api.revokeOtherSessions();
      if (res.token) {
        setAuthToken(res.token);
      }
      onUserUpdated(res.user);
      setSessionActionMessage(res.message || 'All other active sessions have been signed out.');
      await loadSessions();
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Unable to sign out other sessions.');
    } finally {
      setRevokingOthers(false);
      setConfirmRevokeOthersOpen(false);
    }
  }

  async function handleLogoutAllDevices() {
    setSessionsError('');
    setLoggingOutAll(true);
    try {
      await api.logoutAll();
      setConfirmLogoutAllOpen(false);
      onSignedOutAll();
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Unable to sign out active sessions.');
      setConfirmLogoutAllOpen(false);
    } finally {
      setLoggingOutAll(false);
    }
  }

  async function handleSavePreferences(e: React.FormEvent) {
    e.preventDefault();
    setPrefsError('');
    setPrefsSuccess('');
    setPrefsSaving(true);
    try {
      const res = await api.updatePreferences({
        emailNotifications: draftPrefs.emailNotifications,
        reviewNotifications: draftPrefs.reviewNotifications,
        complianceAnalysisNotifications: draftPrefs.complianceAnalysisNotifications,
        productAccountNotifications: draftPrefs.productAccountNotifications,
        defaultPage: draftPrefs.defaultPage,
        sidebarCollapsed: draftPrefs.sidebarCollapsed,
      });
      setSavedPrefs(res.preferences);
      setDraftPrefs(res.preferences);
      setEmailDeliveryConfigured(res.emailDeliveryConfigured);
      onUserUpdated(res.user);
      onSetSidebarCollapsed(res.preferences.sidebarCollapsed);
      setPrefsSuccess('Notification and workspace preferences saved.');
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : 'Unable to save preferences.');
    } finally {
      setPrefsSaving(false);
    }
  }

  async function handleSaveOrganizationName(e: React.FormEvent) {
    e.preventDefault();
    setOrgSaveError('');
    setOrgSaveSuccess('');
    const cleanName = orgNameDraft.trim();
    if (!cleanName || cleanName.length > 120) {
      setOrgSaveError('Organization name must be between 1 and 120 characters.');
      return;
    }
    setOrgSaving(true);
    try {
      const res = await api.updateOrganization(cleanName);
      setOrganization(res.organization);
      setOrgNameDraft(res.organization.name);
      onUserUpdated(res.user);
      setOrgSaveSuccess('Organization workspace name updated.');
    } catch (err) {
      setOrgSaveError(err instanceof Error ? err.message : 'Unable to update organization name.');
    } finally {
      setOrgSaving(false);
    }
  }

  async function handleCreateTeamMember(e: React.FormEvent) {
    e.preventDefault();
    setMemberFormError('');
    setMemberFormSuccess('');

    const cleanName = memberName.trim();
    const cleanEmail = memberEmail.trim().toLowerCase();
    if (!cleanName || cleanName.length > 120) {
      setMemberFormError('Please enter a valid full name (1–120 characters).');
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setMemberFormError('Please enter a valid work email address.');
      return;
    }
    const strength = evaluatePasswordStrength(memberPassword);
    if (!strength.isValid) {
      setMemberFormError(`Temporary password requirement: ${strength.errors.join(', ')}.`);
      return;
    }

    setCreatingMember(true);
    try {
      await api.createTeamMember({
        name: cleanName,
        email: cleanEmail,
        password: memberPassword,
        role: memberRole,
      });
      setMemberName('');
      setMemberEmail('');
      setMemberPassword('');
      setMemberRole('author');
      setShowAddMember(false);
      setMemberFormSuccess(`Added ${cleanName} to ${organization?.name || user.companyName}.`);
      await loadOrganizationData();
    } catch (err) {
      setMemberFormError(err instanceof Error ? err.message : 'Unable to add team member.');
    } finally {
      setCreatingMember(false);
    }
  }

  async function handleUpdateMemberRole(memberId: number, nextRole: 'author' | 'reviewer' | 'admin') {
    setMemberRoleError('');
    setMemberRoleSuccess('');
    setUpdatingMemberId(memberId);
    try {
      const res = await api.updateTeamMemberRole(memberId, nextRole);
      setMembers((prev) => prev.map((m) => (m.id === memberId ? res.member : m)));
      setMemberRoleSuccess(
        `Updated ${res.member.name}'s workspace role to ${formatUserRoleLabel(res.member.role)}.`
      );
    } catch (err) {
      setMemberRoleError(err instanceof Error ? err.message : 'Unable to update member role.');
    } finally {
      setUpdatingMemberId(null);
    }
  }

  const landingPageOptions: Array<{ value: DefaultLandingPage; label: string }> = [
    { value: 'dashboard', label: 'Dashboard Overview' },
    { value: 'guidelines', label: 'Brand Guidelines' },
    { value: 'submit', label: 'Submit Content' },
    { value: 'analysis', label: 'Analysis Results' },
    { value: 'corrections', label: 'Correction Suggestions' },
    ...(isReviewerOrAdmin
      ? [{ value: 'review' as DefaultLandingPage, label: 'Review & Approval' }]
      : []),
    { value: 'history', label: 'Review History' },
  ];

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;

  function renderSessionDeviceIcon(session: UserSessionInfo) {
    const osLower = session.os.toLowerCase();
    if (osLower.includes('ios') || osLower.includes('android')) {
      return <Smartphone className="w-4 h-4 shrink-0" />;
    }
    if (osLower.includes('mac') || osLower.includes('windows') || osLower.includes('linux')) {
      return <Laptop className="w-4 h-4 shrink-0" />;
    }
    return <Monitor className="w-4 h-4 shrink-0" />;
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Responsive Settings Section Navigation */}
        <aside
          aria-label="Settings sections"
          className="w-full lg:w-64 shrink-0 lg:sticky lg:top-6 clay-surface rounded-[28px] p-3 sm:p-4 space-y-2"
        >
          <div className="px-2.5 pt-1 pb-2 hidden lg:block border-b border-slate-200/70 dark:border-violet-400/20">
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300">
              Settings
            </p>
            <p className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5 truncate">
              {user.name}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.companyName}</p>
          </div>

          <nav className="flex lg:flex-col flex-wrap gap-1.5" aria-label="Settings navigation">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentSection === tab.key;
              return (
                <button
                  key={tab.key}
                  id={getSectionButtonId(tab.key)}
                  type="button"
                  onClick={() => handleRequestSectionChange(tab.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 lg:w-full ${
                    isActive
                      ? 'clay-btn-primary'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-indigo-50/80 dark:hover:bg-violet-900/35'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-white' : 'text-indigo-600 dark:text-violet-300'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold leading-snug whitespace-nowrap lg:whitespace-normal">
                      {tab.label}
                    </p>
                    <p
                      className={`text-[11px] hidden lg:block truncate ${
                        isActive ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {tab.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Active Settings Content Panel */}
        <div className="flex-1 min-w-0 w-full space-y-6">
          {/* 1. ACCOUNT OVERVIEW */}
          {currentSection === 'account' && (
            <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <UserAvatar user={user} size="lg" className="rounded-full shrink-0" />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-indigo-600 dark:text-violet-300">
                      <span>{roleLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{user.companyName}</span>
                    </div>
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
                      {user.name}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300 truncate">{user.email}</p>
                  </div>
                </div>

                {user.emailVerified ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/35 shrink-0 whitespace-nowrap">
                    <MailCheck className="w-4 h-4" />
                    Email Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200/80 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/35 shrink-0 whitespace-nowrap">
                    <MailWarning className="w-4 h-4" />
                    Email Unverified
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="clay-well rounded-2xl p-4 space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Account Identity
                  </p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                </div>

                <div className="clay-well rounded-2xl p-4 space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Workspace &amp; Role
                  </p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {user.companyName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{roleLabel}</p>
                </div>

                <div className="clay-well rounded-2xl p-4 space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Account Created
                  </p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white font-mono-tabular">
                    {user.createdAt ? formatDateTime(user.createdAt) : 'Active Workspace Member'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {user.passwordUpdatedAt
                      ? `Password updated ${formatDateTime(user.passwordUpdatedAt)}`
                      : 'Initial credentials active'}
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
                      Confirm ownership of <span className="font-semibold">{user.email}</span> to enable full workspace access, password changes, and team management.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {onRefreshUser && (
                      <button
                        type="button"
                        onClick={handleRefreshVerificationStatus}
                        disabled={refreshingVerify}
                        className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshingVerify ? 'animate-spin' : ''}`} />
                        {refreshingVerify ? 'Checking...' : 'Check Status'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={resendingVerify}
                      className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {resendingVerify ? 'Sending...' : 'Resend Verification Email'}
                    </button>
                  </div>
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

              <div className="pt-2 border-t border-slate-200/70 dark:border-violet-400/20 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Quick Settings Shortcuts
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => handleRequestSectionChange('profile')}
                    className="clay-well rounded-2xl p-4 text-left hover:ring-2 hover:ring-indigo-400/40 transition-shadow cursor-pointer"
                  >
                    <p className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <User className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
                      Edit Profile &amp; Photo
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Update display name, job title, bio, and avatar.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRequestSectionChange('security')}
                    className="clay-well rounded-2xl p-4 text-left hover:ring-2 hover:ring-indigo-400/40 transition-shadow cursor-pointer"
                  >
                    <p className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
                      Password &amp; Sessions
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Rotate credentials or revoke signed-in browsers.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRequestSectionChange('notifications')}
                    className="clay-well rounded-2xl p-4 text-left hover:ring-2 hover:ring-indigo-400/40 transition-shadow cursor-pointer"
                  >
                    <p className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <Bell className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
                      Preferences &amp; Alerts
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Configure default workspace view and alert toggles.
                    </p>
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 2. PROFILE */}
          {currentSection === 'profile' && (
            <div className="space-y-6">
              <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <UserAvatar user={user} size="lg" className="rounded-full shrink-0" />
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300">
                        Profile Picture
                      </p>
                      <h2 className="text-xl font-extrabold text-slate-900 dark:text-white truncate">
                        {user.name}
                      </h2>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Upload a circular headshot or use your organization initials.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarError('');
                        setAvatarStatus('');
                        setAvatarModalOpen(true);
                      }}
                      className="clay-btn-primary rounded-full px-4 py-2.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      {user.avatarFilename ? 'Replace Picture' : 'Upload Picture'}
                    </button>
                    {user.avatarFilename && (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveAvatarOpen(true)}
                        disabled={removingAvatar}
                        className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold text-red-700 dark:text-rose-300 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-55 whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove Picture
                      </button>
                    )}
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
              </section>

              <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300">
                    Personal Information
                  </p>
                  <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                    Profile Details
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Update your workspace identity details. Email and role remain locked for workspace security.
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
                        value={profileName}
                        onChange={(e) => {
                          setProfileName(e.target.value);
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
                        value={profileJobTitle}
                        onChange={(e) => {
                          setProfileJobTitle(e.target.value);
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
                      <span className="text-[11px] font-mono-tabular text-slate-400">
                        {profileBio.length}/500
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={profileBio}
                      onChange={(e) => {
                        setProfileBio(e.target.value);
                        setProfileStatus('');
                        setProfileError('');
                      }}
                      placeholder="Summarize your editorial review or brand governance responsibilities..."
                      className="clay-well w-full rounded-2xl px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 dark:focus:ring-violet-400/60 resize-y"
                    />
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div className="clay-well rounded-2xl px-4 py-3 space-y-0.5 opacity-95">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Registered Email (Read-only)
                      </span>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                        {user.email}
                      </p>
                    </div>
                    <div className="clay-well rounded-2xl px-4 py-3 space-y-0.5 opacity-95">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Account Role (Read-only)
                      </span>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{roleLabel}</p>
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
                      disabled={!profileDirty || savingProfile}
                      onClick={() => {
                        setProfileName(user.name);
                        setProfileJobTitle(user.jobTitle ?? '');
                        setProfileBio(user.bio ?? '');
                        setProfileError('');
                        setProfileStatus('');
                      }}
                      className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold cursor-pointer disabled:opacity-45 whitespace-nowrap"
                    >
                      Discard Changes
                    </button>
                    <button
                      type="submit"
                      disabled={!profileDirty || savingProfile}
                      className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-55 whitespace-nowrap"
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
            </div>
          )}

          {/* 3. APPEARANCE */}
          {currentSection === 'appearance' && (
            <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
                  <Palette className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Workspace Theme</span>
                </div>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  Appearance Settings
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Choose between Light Clay and Dark Clay. Your selection applies immediately across the entire application and syncs to your account.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Light Clay Option */}
                <button
                  type="button"
                  onClick={() => onSelectTheme('light')}
                  aria-pressed={theme === 'light'}
                  className={`rounded-[26px] p-5 text-left transition-all cursor-pointer border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    theme === 'light'
                      ? 'bg-[#F4F6FB] border-indigo-600 shadow-[0_14px_28px_-8px_rgba(79,70,229,0.28)]'
                      : 'bg-[#F4F6FB]/90 border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  <div className="rounded-2xl p-4 bg-white border border-slate-200/80 shadow-sm space-y-2.5 mb-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
                        <Sun className="w-4 h-4 text-amber-500" />
                        Light Clay Preview
                      </span>
                      <span className="w-3 h-3 rounded-full bg-indigo-600" />
                    </div>
                    <div className="h-2.5 w-3/4 rounded-full bg-slate-200" />
                    <div className="h-2.5 w-1/2 rounded-full bg-indigo-100" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">Light Clay</p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Crisp porcelain surfaces with indigo highlights.
                      </p>
                    </div>
                    {theme === 'light' && (
                      <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold bg-indigo-600 text-white shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Active
                      </span>
                    )}
                  </div>
                </button>

                {/* Dark Clay Option */}
                <button
                  type="button"
                  onClick={() => onSelectTheme('dark')}
                  aria-pressed={theme === 'dark'}
                  className={`rounded-[26px] p-5 text-left transition-all cursor-pointer border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                    theme === 'dark'
                      ? 'bg-[#120b2d] border-violet-400 shadow-[0_14px_30px_-8px_rgba(139,92,246,0.45)]'
                      : 'bg-[#18113c] border-violet-500/30 hover:border-violet-400/70'
                  }`}
                >
                  <div className="rounded-2xl p-4 bg-[#1f164c] border border-violet-400/25 shadow-sm space-y-2.5 mb-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-white">
                        <Moon className="w-4 h-4 text-violet-300" />
                        Dark Clay Preview
                      </span>
                      <span className="w-3 h-3 rounded-full bg-violet-400" />
                    </div>
                    <div className="h-2.5 w-3/4 rounded-full bg-violet-300/25" />
                    <div className="h-2.5 w-1/2 rounded-full bg-cyan-400/35" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-white">Dark Clay</p>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Deep twilight indigo surfaces with violet contrast.
                      </p>
                    </div>
                    {theme === 'dark' && (
                      <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold bg-violet-500 text-white shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Active
                      </span>
                    )}
                  </div>
                </button>
              </div>
            </section>
          )}

          {/* 4. SECURITY */}
          {currentSection === 'security' && (
            <div className="space-y-6">
              {/* Change Password */}
              <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
                    <KeyRound className="w-5 h-5" />
                    <span className="text-xs font-bold uppercase tracking-wider">Credentials</span>
                  </div>
                  <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                    Change Password
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Updating your password rotates your active session token and signs out all other signed-in browsers.
                  </p>
                </div>

                {needsVerification && (
                  <div
                    role="status"
                    className="rounded-2xl px-4 py-3 text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30 flex flex-wrap items-center justify-between gap-2"
                  >
                    <span>Verify your email address in Account Overview before changing your password.</span>
                    <button
                      type="button"
                      onClick={() => handleRequestSectionChange('account')}
                      className="underline font-bold cursor-pointer"
                    >
                      Go to Account Overview
                    </button>
                  </div>
                )}

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
                      disabled={changingPassword || needsVerification}
                      className="clay-btn-primary rounded-full px-6 py-3 text-sm font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-55 whitespace-nowrap"
                    >
                      <KeyRound className="w-4 h-4" />
                      {changingPassword ? 'Updating Password...' : 'Update Password'}
                    </button>
                  </div>
                </form>
              </section>

              {/* Active Sessions Management */}
              <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
                      <ShieldCheck className="w-5 h-5" />
                      <span className="text-xs font-bold uppercase tracking-wider">Session Control</span>
                    </div>
                    <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                      Active Sessions
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Review browsers signed in to your account and revoke sessions you no longer recognize.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void loadSessions()}
                    disabled={sessionsLoading}
                    className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-55 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${sessionsLoading ? 'animate-spin' : ''}`} />
                    Refresh Sessions
                  </button>
                </div>

                {sessionActionMessage && (
                  <div
                    role="status"
                    className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30 flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{sessionActionMessage}</span>
                  </div>
                )}

                {sessionsError && (
                  <div
                    role="alert"
                    className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
                  >
                    {sessionsError}
                  </div>
                )}

                {sessionsLoading && sessions.length === 0 ? (
                  <div className="clay-well rounded-2xl p-6 flex items-center justify-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-300">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading active sessions...
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="clay-well rounded-2xl p-5 text-xs text-slate-600 dark:text-slate-300">
                    No active tracked sessions found for your current token version.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className={`clay-well rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          session.isCurrent
                            ? 'ring-2 ring-indigo-500/35 dark:ring-violet-400/45'
                            : ''
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-violet-500/20 text-indigo-600 dark:text-violet-300 flex items-center justify-center shrink-0">
                            {renderSessionDeviceIcon(session)}
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-bold text-slate-900 dark:text-white">
                                {session.deviceSummary}
                              </p>
                              {session.isCurrent && (
                                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-indigo-100 text-indigo-800 dark:bg-violet-500/25 dark:text-violet-200">
                                  Current Session
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 font-mono-tabular">
                              IP: {session.ipAddress || 'Local / Proxy'} · Signed in{' '}
                              {formatDateTime(session.createdAt)}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                              Last seen {formatDateTime(session.lastSeenAt)} · Expires{' '}
                              {formatDateTime(session.expiresAt)}
                            </p>
                          </div>
                        </div>

                        {!session.isCurrent && (
                          <button
                            type="button"
                            onClick={() => void handleRevokeSingleSession(session.id)}
                            disabled={revokingSessionId === session.id}
                            className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-bold text-red-700 dark:text-rose-300 shrink-0 cursor-pointer disabled:opacity-55 whitespace-nowrap"
                          >
                            {revokingSessionId === session.id ? 'Revoking...' : 'Revoke'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-4 border-t border-slate-200/70 dark:border-violet-400/20 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setConfirmRevokeOthersOpen(true)}
                      disabled={otherSessionsCount === 0}
                      className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-45 whitespace-nowrap"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Sign Out Other Devices ({otherSessionsCount})
                    </button>

                    <button
                      type="button"
                      onClick={onLogout}
                      className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out This Session
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setConfirmLogoutAllOpen(true)}
                    className="clay-btn-secondary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 text-red-700 dark:text-rose-300 shrink-0 cursor-pointer whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out All Sessions
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* 5. NOTIFICATIONS & PREFERENCES */}
          {currentSection === 'notifications' && (
            <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
                  <Bell className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Alerts &amp; Workflow</span>
                </div>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  Notifications &amp; Preferences
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Configure notification behavior and your default workspace layout. Changes persist across sessions.
                </p>
              </div>

              {emailDeliveryConfigured !== null && (
                <div
                  role="status"
                  className={`rounded-2xl px-4 py-3 text-xs font-semibold border ${
                    emailDeliveryConfigured
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30'
                      : 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30'
                  }`}
                >
                  {emailDeliveryConfigured
                    ? 'Email delivery is active via Brevo HTTPS API. Essential security emails (verification, password reset, and password change alerts) are always enabled for account safety.'
                    : 'Outbound email delivery is not configured on this server yet. Your notification preferences are still saved to your account, and transactional emails will deliver once Brevo API credentials are set.'}
                </div>
              )}

              {prefsLoading ? (
                <div className="clay-well rounded-2xl p-6 flex items-center justify-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-300">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading preferences...
                </div>
              ) : (
                <form onSubmit={handleSavePreferences} className="space-y-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      Notification Preferences
                    </h3>

                    {(
                      [
                        {
                          key: 'emailNotifications',
                          label: 'Workspace Email Notifications',
                          desc: 'Receive non-security workspace notifications at your registered email address.',
                        },
                        {
                          key: 'reviewNotifications',
                          label: 'Review & Approval Activity',
                          desc: 'Notify when submissions are approved, rejected, or have revision requests.',
                        },
                        {
                          key: 'complianceAnalysisNotifications',
                          label: 'Compliance Analysis Results',
                          desc: 'Notify when brand compliance scans finish or surface critical issues.',
                        },
                        {
                          key: 'productAccountNotifications',
                          label: 'Account & Organization Updates',
                          desc: 'Receive updates about workspace membership or configuration changes.',
                        },
                      ] as const
                    ).map((item) => (
                      <label
                        key={item.key}
                        className="clay-well rounded-2xl p-4 flex items-center justify-between gap-4 cursor-pointer"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">
                            {item.label}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">{item.desc}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={draftPrefs[item.key]}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setDraftPrefs((prev) => ({ ...prev, [item.key]: checked }));
                            setPrefsSuccess('');
                            setPrefsError('');
                          }}
                          className="w-5 h-5 rounded accent-indigo-600 dark:accent-violet-400 shrink-0 cursor-pointer"
                        />
                      </label>
                    ))}
                  </div>

                  <div className="pt-4 border-t border-slate-200/70 dark:border-violet-400/20 space-y-4">
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      Workspace Interface Preferences
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <label className="clay-well rounded-2xl p-4 block space-y-2">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          Default Landing Page
                        </span>
                        <select
                          value={draftPrefs.defaultPage}
                          onChange={(e) => {
                            setDraftPrefs((prev) => ({
                              ...prev,
                              defaultPage: e.target.value as DefaultLandingPage,
                            }));
                            setPrefsSuccess('');
                            setPrefsError('');
                          }}
                          className="w-full rounded-xl px-3 py-2 text-sm font-semibold bg-white/90 dark:bg-[#18113c] text-slate-900 dark:text-white border border-slate-200 dark:border-violet-400/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                        >
                          {landingPageOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Section opened automatically when signing in.
                        </p>
                      </label>

                      <label className="clay-well rounded-2xl p-4 flex items-center justify-between gap-4 cursor-pointer">
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                            Compact Sidebar Default
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Keep the desktop navigation rail collapsed for wider content space.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={draftPrefs.sidebarCollapsed}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setDraftPrefs((prev) => ({ ...prev, sidebarCollapsed: checked }));
                            setPrefsSuccess('');
                            setPrefsError('');
                          }}
                          className="w-5 h-5 rounded accent-indigo-600 dark:accent-violet-400 shrink-0 cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>

                  {prefsSuccess && (
                    <div
                      role="status"
                      className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30 flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{prefsSuccess}</span>
                    </div>
                  )}

                  {prefsError && (
                    <div
                      role="alert"
                      className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
                    >
                      {prefsError}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2.5">
                    <button
                      type="button"
                      disabled={!prefsDirty || prefsSaving}
                      onClick={() => {
                        setDraftPrefs(savedPrefs);
                        setPrefsError('');
                        setPrefsSuccess('');
                      }}
                      className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold cursor-pointer disabled:opacity-45 whitespace-nowrap"
                    >
                      Discard Changes
                    </button>
                    <button
                      type="submit"
                      disabled={!prefsDirty || prefsSaving}
                      className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-55 whitespace-nowrap"
                    >
                      {prefsSaving ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Save Preferences
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          {/* 6. ORGANIZATION / WORKSPACE */}
          {currentSection === 'organization' && (
            <div className="space-y-6">
              <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
                      <Building2 className="w-5 h-5" />
                      <span className="text-xs font-bold uppercase tracking-wider">Workspace</span>
                    </div>
                    <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                      {organization?.name || user.companyName}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {organization?.createdAt
                        ? `Created ${formatDateTime(organization.createdAt)} · Your Role: ${roleLabel}`
                        : `Your Role: ${roleLabel}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void loadOrganizationData()}
                    disabled={orgLoading}
                    className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-55 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${orgLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {orgLoadError && (
                  <div
                    role="alert"
                    className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
                  >
                    {orgLoadError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="clay-well rounded-2xl p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Team Members
                    </p>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-white font-mono-tabular mt-1">
                      {organization ? organization.memberCount : '—'}
                    </p>
                  </div>
                  <div className="clay-well rounded-2xl p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Brand Profiles
                    </p>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-white font-mono-tabular mt-1">
                      {organization ? organization.brandCount : '—'}
                    </p>
                  </div>
                  <div className="clay-well rounded-2xl p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Compliance Audits
                    </p>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-white font-mono-tabular mt-1">
                      {organization ? organization.submissionCount : '—'}
                    </p>
                  </div>
                </div>

                {canManageWorkspace ? (
                  <form
                    onSubmit={handleSaveOrganizationName}
                    className="pt-4 border-t border-slate-200/70 dark:border-violet-400/20 space-y-3 max-w-xl"
                  >
                    <label className="block space-y-1.5">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        Organization / Workspace Name
                      </span>
                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <input
                          type="text"
                          required
                          maxLength={120}
                          disabled={needsVerification || orgSaving}
                          value={orgNameDraft}
                          onChange={(e) => {
                            setOrgNameDraft(e.target.value);
                            setOrgSaveError('');
                            setOrgSaveSuccess('');
                          }}
                          className="clay-well flex-1 rounded-2xl px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                        />
                        <button
                          type="submit"
                          disabled={!orgDirty || orgSaving || needsVerification}
                          className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-55 whitespace-nowrap shrink-0"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {orgSaving ? 'Saving...' : 'Update Name'}
                        </button>
                      </div>
                    </label>

                    {needsVerification && (
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                        Verify your email address before modifying workspace settings.
                      </p>
                    )}

                    {orgSaveSuccess && (
                      <div
                        role="status"
                        className="rounded-2xl px-4 py-2.5 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30"
                      >
                        {orgSaveSuccess}
                      </div>
                    )}

                    {orgSaveError && (
                      <div
                        role="alert"
                        className="rounded-2xl px-4 py-2.5 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
                      >
                        {orgSaveError}
                      </div>
                    )}
                  </form>
                ) : (
                  <div className="clay-well rounded-2xl px-4 py-3 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>
                      Workspace administration and team provisioning are restricted to organization Reviewers.
                    </span>
                  </div>
                )}
              </section>

              {/* Team Members Directory & Management */}
              <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
                      <Users className="w-5 h-5" />
                      <span className="text-xs font-bold uppercase tracking-wider">Directory</span>
                    </div>
                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                      Team Members
                    </h3>
                  </div>

                  {canManageWorkspace && !needsVerification && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddMember((prev) => !prev);
                        setMemberFormError('');
                      }}
                      className="clay-btn-primary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {showAddMember ? 'Close Form' : 'Add Team Member'}
                    </button>
                  )}
                </div>

                {showAddMember && canManageWorkspace && !needsVerification && (
                  <form
                    onSubmit={handleCreateTeamMember}
                    className="clay-well rounded-2xl p-5 space-y-4 border border-indigo-200/70 dark:border-violet-400/25"
                  >
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white">
                      Provision New Workspace Member
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <label className="block space-y-1">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          Full Name
                        </span>
                        <input
                          type="text"
                          required
                          maxLength={120}
                          value={memberName}
                          onChange={(e) => setMemberName(e.target.value)}
                          placeholder="Alex Morgan"
                          className="w-full rounded-xl px-3.5 py-2 text-sm bg-white/90 dark:bg-[#18113c] text-slate-900 dark:text-white border border-slate-200 dark:border-violet-400/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                        />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          Work Email
                        </span>
                        <input
                          type="email"
                          required
                          maxLength={254}
                          value={memberEmail}
                          onChange={(e) => setMemberEmail(e.target.value)}
                          placeholder="alex@company.com"
                          className="w-full rounded-xl px-3.5 py-2 text-sm bg-white/90 dark:bg-[#18113c] text-slate-900 dark:text-white border border-slate-200 dark:border-violet-400/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                      <PasswordField
                        id="settings-member-password"
                        label="Initial Password"
                        value={memberPassword}
                        onChange={setMemberPassword}
                        placeholder="Create initial password"
                        autoComplete="new-password"
                        showStrength
                        disabled={creatingMember}
                      />

                      <label className="block space-y-1">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          Workspace Role
                        </span>
                        <select
                          value={memberRole}
                          onChange={(e) => {
                            const next = e.target.value;
                            setMemberRole(
                              next === 'admin' && isAdmin
                                ? 'admin'
                                : next === 'reviewer'
                                  ? 'reviewer'
                                  : 'author'
                            );
                          }}
                          className="w-full rounded-xl px-3.5 py-2.5 text-sm font-semibold bg-white/90 dark:bg-[#18113c] text-slate-900 dark:text-white border border-slate-200 dark:border-violet-400/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                        >
                          <option value="author">Author (Submit &amp; Revise Content)</option>
                          <option value="reviewer">Reviewer (Approve, Brands &amp; Team Management)</option>
                          {isAdmin && (
                            <option value="admin">Admin (Full Workspace Administration)</option>
                          )}
                        </select>
                      </label>
                    </div>

                    {memberFormError && (
                      <div
                        role="alert"
                        className="rounded-xl px-3.5 py-2.5 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
                      >
                        {memberFormError}
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddMember(false)}
                        className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-bold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={creatingMember}
                        className="clay-btn-primary rounded-full px-5 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-55"
                      >
                        {creatingMember ? 'Adding Member...' : 'Create Member'}
                      </button>
                    </div>
                  </form>
                )}

                {memberFormSuccess && (
                  <div
                    role="status"
                    className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30"
                  >
                    {memberFormSuccess}
                  </div>
                )}

                {memberRoleSuccess && (
                  <div
                    role="status"
                    className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30"
                  >
                    {memberRoleSuccess}
                  </div>
                )}

                {memberRoleError && (
                  <div
                    role="alert"
                    className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
                  >
                    {memberRoleError}
                  </div>
                )}

                {needsVerification ? (
                  <div className="clay-well rounded-2xl p-5 text-xs text-slate-600 dark:text-slate-300">
                    Verify your email address in Account Overview to view and manage the full organization member directory.
                  </div>
                ) : orgLoading && members.length === 0 ? (
                  <div className="clay-well rounded-2xl p-6 flex items-center justify-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-300">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading team directory...
                  </div>
                ) : members.length === 0 ? (
                  <div className="clay-well rounded-2xl p-5 text-xs text-slate-600 dark:text-slate-300">
                    No team members found in this organization.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200/70 dark:divide-violet-400/15">
                    {members.map((member) => {
                      const isSelf = member.id === user.id;
                      return (
                        <div
                          key={member.id}
                          className="py-3.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {isSelf ? (
                              <UserAvatar user={user} size="sm" />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-violet-500/25 text-indigo-800 dark:text-violet-200 font-extrabold text-xs flex items-center justify-center shrink-0">
                                {getUserInitials(member.name, member.email)}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                  {member.name}
                                </p>
                                {isSelf && (
                                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-violet-500/25 dark:text-violet-200">
                                    You
                                  </span>
                                )}
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    member.emailVerified
                                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                      : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                                  }`}
                                >
                                  {member.emailVerified ? 'Verified' : 'Unverified'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {member.email}
                                {member.jobTitle ? ` · ${member.jobTitle}` : ''}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                            <span className="text-[11px] font-mono-tabular text-slate-400 hidden md:inline">
                              Joined {formatDateTime(member.createdAt)}
                            </span>

                            {canManageWorkspace && !isSelf && (member.role !== 'admin' || isAdmin) ? (
                              <select
                                aria-label={`Role for ${member.name}`}
                                disabled={updatingMemberId === member.id}
                                value={
                                  member.role === 'admin'
                                    ? 'admin'
                                    : member.role === 'reviewer'
                                      ? 'reviewer'
                                      : 'author'
                                }
                                onChange={(e) => {
                                  const next = e.target.value;
                                  const validated: 'author' | 'reviewer' | 'admin' =
                                    next === 'admin' && isAdmin
                                      ? 'admin'
                                      : next === 'reviewer'
                                        ? 'reviewer'
                                        : 'author';
                                  void handleUpdateMemberRole(member.id, validated);
                                }}
                                className="rounded-full px-3 py-1.5 text-xs font-bold bg-white/90 dark:bg-[#18113c] text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-violet-400/30 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                              >
                                <option value="author">Author</option>
                                <option value="reviewer">Reviewer</option>
                                {isAdmin && <option value="admin">Admin</option>}
                              </select>
                            ) : (
                              <span className="clay-well rounded-full px-3 py-1 text-xs font-bold text-slate-700 dark:text-slate-200">
                                {formatUserRoleLabel(member.role)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Avatar Editor Modal */}
      <AvatarEditorModal
        open={avatarModalOpen}
        hasExistingAvatar={Boolean(user.avatarFilename)}
        onClose={() => setAvatarModalOpen(false)}
        onSave={handleSaveAvatar}
      />

      {/* Destructive Action Modals */}
      <ConfirmModal
        open={confirmRemoveAvatarOpen}
        title="Remove Profile Picture"
        message="This will delete your uploaded profile picture and restore your initials avatar across the workspace."
        confirmLabel="Remove Picture"
        variant="danger"
        loading={removingAvatar}
        onConfirm={() => void handleRemoveAvatarConfirmed()}
        onCancel={() => setConfirmRemoveAvatarOpen(false)}
      />

      <ConfirmModal
        open={confirmRevokeOthersOpen}
        title="Sign Out Other Devices"
        message="This will immediately sign out every other browser or device using your account while keeping this current browser signed in."
        confirmLabel="Sign Out Other Devices"
        variant="primary"
        loading={revokingOthers}
        onConfirm={() => void handleRevokeOtherSessionsConfirmed()}
        onCancel={() => setConfirmRevokeOthersOpen(false)}
      />

      <ConfirmModal
        open={confirmLogoutAllOpen}
        title="Sign Out All Active Sessions"
        message="This will immediately invalidate every active session for your account, including this browser. You will need to sign in again."
        confirmLabel="Sign Out All Sessions"
        variant="danger"
        loading={loggingOutAll}
        onConfirm={() => void handleLogoutAllDevices()}
        onCancel={() => setConfirmLogoutAllOpen(false)}
      />

      <ConfirmModal
        open={pendingSectionSwitch !== null}
        title="Discard Unsaved Changes?"
        message="You have unsaved edits in this Settings section. Switching sections now will discard your unsaved changes."
        confirmLabel="Discard & Switch"
        variant="primary"
        onConfirm={() => {
          const target = pendingSectionSwitch;
          resetCurrentSectionDraft();
          setPendingSectionSwitch(null);
          if (target) {
            onSectionChange?.(target);
          }
        }}
        onCancel={() => setPendingSectionSwitch(null)}
      />
    </div>
  );
}
