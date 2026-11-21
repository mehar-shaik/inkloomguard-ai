import React, { useEffect, useState } from 'react';
import {
  Search,
  X,
  MailWarning,
  RefreshCw,
  Send,
} from 'lucide-react';
import {
  api,
  clearAuthToken,
  getAuthToken,
  setAuthToken,
  setUnauthorizedHandler,
} from './api';
import type { AuthUser, PageKey, SettingsSection, Submission } from './types';
import { VALID_PAGE_KEYS, VALID_SETTINGS_SECTIONS } from './config/navigation';
import { LoadingPanel, StatusBadge } from './components/ClayUI';
import { AppSidebar } from './components/AppSidebar';
import { TopNavHeader } from './components/TopNavHeader';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthPage } from './pages/AuthPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { DashboardPage } from './pages/DashboardPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { GuidelinesPage } from './pages/GuidelinesPage';
import { SubmitPage } from './pages/SubmitPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { CorrectionsPage } from './pages/CorrectionsPage';
import { ReviewPage } from './pages/ReviewPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';

type PublicAuthView =
  | { view: 'auth' }
  | { view: 'forgot-password' }
  | { view: 'reset-password'; token: string }
  | { view: 'verify-email'; token: string; email?: string };

function parseInitialPublicAuthView(): PublicAuthView {
  if (typeof window === 'undefined') return { view: 'auth' };
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const token = params.get('token') || '';
  if (mode === 'forgot-password') return { view: 'forgot-password' };
  if (mode === 'reset-password') return { view: 'reset-password', token };
  if (mode === 'verify-email') return { view: 'verify-email', token };
  return { view: 'auth' };
}

function clearAuthQueryParams(): void {
  if (typeof window === 'undefined') return;
  if (window.location.search) {
    const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState(null, '', cleanUrl);
  }
}

function parseHashState(): {
  page: PageKey;
  brandId: number | null;
  submissionId: number | null;
  settingsSection: SettingsSection | null;
} {
  if (typeof window === 'undefined') {
    return { page: 'dashboard', brandId: null, submissionId: null, settingsSection: null };
  }
  const raw = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(raw);
  const pageParam = params.get('page') as PageKey | null;
  const page: PageKey = pageParam && VALID_PAGE_KEYS.has(pageParam) ? pageParam : 'dashboard';
  const sectionParam = params.get('section') as SettingsSection | null;
  const settingsSection: SettingsSection | null =
    page === 'settings' && sectionParam && VALID_SETTINGS_SECTIONS.has(sectionParam)
      ? sectionParam
      : null;
  const bId = Number(params.get('brandId'));
  const sId = Number(params.get('submissionId'));
  return {
    page,
    brandId: Number.isInteger(bId) && bId > 0 ? bId : null,
    submissionId: Number.isInteger(sId) && sId > 0 ? sId : null,
    settingsSection,
  };
}

function buildHashString(
  page: PageKey,
  brandId: number | null,
  submissionId: number | null,
  settingsSection: SettingsSection | null
): string {
  const params = new URLSearchParams();
  params.set('page', page);
  if (page === 'settings' && settingsSection) {
    params.set('section', settingsSection);
  }
  if (brandId && brandId > 0) params.set('brandId', String(brandId));
  if (submissionId && submissionId > 0) params.set('submissionId', String(submissionId));
  return `#${params.toString()}`;
}

export default function App() {
  const initialHash = parseHashState();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionNotice, setSessionNotice] = useState('');
  const [authView, setAuthView] = useState<PublicAuthView>(() => parseInitialPublicAuthView());
  const [activePage, setActivePage] = useState<PageKey>(initialHash.page);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(
    initialHash.settingsSection
  );
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(initialHash.brandId);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(initialHash.submissionId);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('inkloom_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);
  const [verifyBannerLoading, setVerifyBannerLoading] = useState(false);
  const [verifyBannerMessage, setVerifyBannerMessage] = useState('');
  const [verifyBannerError, setVerifyBannerError] = useState('');

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('inkloom_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  // Quick Search (Cmd/Ctrl + K)
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<Submission[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('inkloom_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('inkloom_sidebar_collapsed', String(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    function syncFromHash() {
      const next = parseHashState();
      setActivePage(next.page);
      setSettingsSection(next.settingsSection);
      if (next.brandId !== null) setSelectedBrandId(next.brandId);
      if (next.submissionId !== null) setSelectedSubmissionId(next.submissionId);
    }
    window.addEventListener('hashchange', syncFromHash);
    window.addEventListener('popstate', syncFromHash);
    return () => {
      window.removeEventListener('hashchange', syncFromHash);
      window.removeEventListener('popstate', syncFromHash);
    };
  }, []);

  useEffect(() => {
    if (!user || authView.view !== 'auth') return;
    const nextHash = buildHashString(activePage, selectedBrandId, selectedSubmissionId, settingsSection);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [user, authView.view, activePage, selectedBrandId, selectedSubmissionId, settingsSection]);

  useEffect(() => {
    setUnauthorizedHandler((msg) => {
      setUser(null);
      setSelectedBrandId(null);
      setSelectedSubmissionId(null);
      setAuthView({ view: 'auth' });
      setSessionNotice(msg || 'Your session expired. Please sign in again.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    const existingToken = getAuthToken();
    if (!existingToken) {
      setUser(null);
      setCheckingSession(false);
      return;
    }

    api
      .me()
      .then((res) => {
        setUser(res.user);
        if (res.user.preferences?.theme === 'light' || res.user.preferences?.theme === 'dark') {
          setTheme(res.user.preferences.theme);
        }
        if (typeof res.user.preferences?.sidebarCollapsed === 'boolean') {
          setSidebarCollapsed(res.user.preferences.sidebarCollapsed);
        }
        setSessionNotice('');
      })
      .catch(() => {
        clearAuthToken();
        setUser(null);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (user && !(user.verificationRequired && !user.emailVerified)) {
          void openQuickSearch();
        }
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user]);

  async function openQuickSearch() {
    if (user?.verificationRequired && !user.emailVerified) {
      return;
    }
    setSearchOpen(true);
    setSearchText('');
    try {
      const res = await api.getSubmissions();
      setSearchResults(res.submissions);
    } catch {
      setSearchResults([]);
    }
  }

  async function handleAuthSuccess(
    token: string,
    meta?: { verificationEmailSent?: boolean; verificationEmailError?: string }
  ) {
    setAuthToken(token);
    setCheckingSession(true);
    try {
      const verified = await api.me();
      setUser(verified.user);
      if (verified.user.preferences?.theme === 'light' || verified.user.preferences?.theme === 'dark') {
        setTheme(verified.user.preferences.theme);
      }
      if (typeof verified.user.preferences?.sidebarCollapsed === 'boolean') {
        setSidebarCollapsed(verified.user.preferences.sidebarCollapsed);
      }
      const preferredLanding = verified.user.preferences?.defaultPage;
      const canLandOnReview =
        verified.user.role === 'reviewer' || verified.user.role === 'admin';
      const landingPage: PageKey =
        preferredLanding &&
        VALID_PAGE_KEYS.has(preferredLanding) &&
        (preferredLanding !== 'review' || canLandOnReview)
          ? preferredLanding
          : 'dashboard';
      setSessionNotice('');
      setAuthView({ view: 'auth' });
      clearAuthQueryParams();
      setActivePage(landingPage);
      setSettingsSection(null);
      setVerifyBannerDismissed(false);
      if (meta?.verificationEmailSent) {
        setVerifyBannerMessage(
          `Verification link sent to ${verified.user.email}. Please check your inbox to verify your account.`
        );
        setVerifyBannerError('');
      } else if (meta?.verificationEmailError) {
        setVerifyBannerMessage('');
        setVerifyBannerError(meta.verificationEmailError);
      } else {
        setVerifyBannerMessage('');
        setVerifyBannerError('');
      }
    } catch (err) {
      clearAuthToken();
      setUser(null);
      setSessionNotice('Session verification failed. Please sign in again.');
      throw err;
    } finally {
      setCheckingSession(false);
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => {});
    clearAuthToken();
    setUser(null);
    setSessionNotice('');
    setSelectedBrandId(null);
    setSelectedSubmissionId(null);
    setActivePage('dashboard');
    setAuthView({ view: 'auth' });
    clearAuthQueryParams();
  }

  function handleSignedOutAll() {
    clearAuthToken();
    setUser(null);
    setSelectedBrandId(null);
    setSelectedSubmissionId(null);
    setActivePage('dashboard');
    setAuthView({ view: 'auth' });
    setSessionNotice('All active sessions were signed out. Please sign in again.');
  }

  async function handleBannerResendVerification() {
    setVerifyBannerLoading(true);
    setVerifyBannerMessage('');
    setVerifyBannerError('');
    try {
      const res = await api.resendVerification();
      setVerifyBannerMessage(res.message);
    } catch (err) {
      setVerifyBannerError(err instanceof Error ? err.message : 'Unable to send verification email.');
    } finally {
      setVerifyBannerLoading(false);
    }
  }

  async function handleRefreshCurrentUser(): Promise<AuthUser | null> {
    const res = await api.me();
    setUser(res.user);
    if (res.user.emailVerified) {
      setVerifyBannerMessage('');
      setVerifyBannerError('');
    }
    return res.user;
  }

  function navigateToPage(page: PageKey) {
    setActivePage(page);
    setSettingsSection(null);
    setMobileNavOpen(false);
  }

  function navigateToSettings(section: SettingsSection) {
    setActivePage('settings');
    setSettingsSection(section);
    setMobileNavOpen(false);
  }

  function handleSelectSubmission(submissionId: number, page: PageKey) {
    setSelectedSubmissionId(submissionId);
    setActivePage(page);
    setSettingsSection(null);
    setMobileNavOpen(false);
  }

  function applyTheme(nextTheme: 'light' | 'dark') {
    setTheme(nextTheme);
    if (user) {
      void api
        .updatePreferences({ theme: nextTheme })
        .then((res) => {
          setUser((prev) => (prev ? { ...prev, preferences: res.preferences } : prev));
        })
        .catch(() => {});
    }
  }

  const toggleTheme = () => applyTheme(theme === 'light' ? 'dark' : 'light');

  function handleToggleSidebarCollapse() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (user) {
        void api
          .updatePreferences({ sidebarCollapsed: next })
          .then((res) => {
            setUser((curr) => (curr ? { ...curr, preferences: res.preferences } : curr));
          })
          .catch(() => {});
      }
      return next;
    });
  }

  if (checkingSession) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-md w-full">
            <LoadingPanel label="Verifying InkloomGuard AI session..." />
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  if (authView.view === 'verify-email') {
    return (
      <ErrorBoundary>
        <VerifyEmailPage
          token={authView.token}
          isAuthenticated={Boolean(user)}
          userEmail={user?.email}
          userEmailVerified={user?.emailVerified}
          initialEmail={authView.email}
          theme={theme}
          onToggleTheme={toggleTheme}
          onVerifiedRefresh={async () => {
            await handleRefreshCurrentUser();
          }}
          onBackToApp={() => {
            clearAuthQueryParams();
            setAuthView({ view: 'auth' });
          }}
        />
      </ErrorBoundary>
    );
  }

  if (!user) {
    if (authView.view === 'forgot-password') {
      return (
        <ErrorBoundary>
          <ForgotPasswordPage
            theme={theme}
            onToggleTheme={toggleTheme}
            onBackToLogin={() => {
              clearAuthQueryParams();
              setAuthView({ view: 'auth' });
            }}
          />
        </ErrorBoundary>
      );
    }

    if (authView.view === 'reset-password') {
      return (
        <ErrorBoundary>
          <ResetPasswordPage
            token={authView.token}
            theme={theme}
            onToggleTheme={toggleTheme}
            onGoForgotPassword={() => {
              clearAuthQueryParams();
              setAuthView({ view: 'forgot-password' });
            }}
            onBackToLogin={() => {
              clearAuthQueryParams();
              setAuthView({ view: 'auth' });
            }}
          />
        </ErrorBoundary>
      );
    }

    return (
      <ErrorBoundary>
        <AuthPage
          onAuthSuccess={handleAuthSuccess}
          onForgotPassword={() => setAuthView({ view: 'forgot-password' })}
          onResendVerification={(email?: string) =>
            setAuthView({ view: 'verify-email', token: '', email: email || undefined })
          }
          theme={theme}
          onToggleTheme={toggleTheme}
          sessionNotice={sessionNotice}
        />
      </ErrorBoundary>
    );
  }

  const verificationGateActive = Boolean(user.verificationRequired && !user.emailVerified);
  const filteredQuickResults = searchResults.filter(
    (s) =>
      !searchText.trim() ||
      s.title.toLowerCase().includes(searchText.toLowerCase()) ||
      (s.brand_name || '').toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <ErrorBoundary
      onReset={() => {
        setActivePage('dashboard');
        setSelectedSubmissionId(null);
      }}
    >
      <div className="min-h-screen flex p-3 sm:p-5 lg:p-6 gap-5 lg:gap-6 relative">
      {/* Subtle Background Ambient Spheres */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-32 left-1/4 w-96 h-96 rounded-full bg-indigo-300/20 dark:bg-violet-600/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 right-10 w-80 h-80 rounded-full bg-sky-200/25 dark:bg-sky-600/10 blur-3xl"
      />

      <AppSidebar
        user={user}
        activePage={activePage}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        onSelectPage={navigateToPage}
        onToggleCollapse={handleToggleSidebarCollapse}
        onCloseMobile={() => setMobileNavOpen(false)}
        onLogout={handleLogout}
      />

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col gap-6 relative z-10">
        <TopNavHeader
          user={user}
          activePage={activePage}
          settingsSection={settingsSection}
          theme={theme}
          searchDisabled={verificationGateActive}
          onToggleTheme={toggleTheme}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onOpenQuickSearch={openQuickSearch}
          onOpenProfile={() => navigateToPage('profile')}
          onOpenAccountSettings={() => navigateToSettings('account')}
          onOpenSecurity={() => navigateToSettings('security')}
          onLogout={handleLogout}
        />

        {/* Unverified Email Notice Banner (optional for pre-migration legacy users only; required users get full gate below) */}
        {!user.emailVerified && !verificationGateActive && !verifyBannerDismissed && activePage !== 'settings' && (
          <div
            role="status"
            className="clay-surface rounded-[24px] px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-amber-200/90 dark:border-amber-400/30"
          >
            <div className="flex items-start sm:items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                <MailWarning className="w-4 h-4" />
              </div>
              <div className="text-xs space-y-0.5 min-w-0">
                <p className="font-bold text-slate-900 dark:text-white">
                  Verify your email address ({user.email})
                </p>
                {verifyBannerMessage ? (
                  <p className="text-emerald-700 dark:text-emerald-300 font-semibold">{verifyBannerMessage}</p>
                ) : verifyBannerError ? (
                  <p className="text-red-700 dark:text-rose-300 font-semibold">{verifyBannerError}</p>
                ) : (
                  <p className="text-slate-600 dark:text-slate-300">
                    Confirm your email to protect password recovery and account security alerts.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleBannerResendVerification}
                disabled={verifyBannerLoading}
                className="clay-btn-primary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                {verifyBannerLoading ? 'Sending...' : 'Resend Link'}
              </button>
              <button
                type="button"
                onClick={() => setActivePage('settings')}
                className="clay-btn-secondary rounded-full px-3.5 py-2 text-xs font-semibold cursor-pointer"
              >
                Security Settings
              </button>
              <button
                type="button"
                onClick={() => setVerifyBannerDismissed(true)}
                aria-label="Dismiss verification notice"
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Active Page Viewport */}
        <main className="flex-1 min-w-0 pb-6">
          {verificationGateActive && activePage !== 'settings' && activePage !== 'profile' ? (
            <section className="clay-surface rounded-[30px] p-7 sm:p-10 max-w-2xl space-y-6 border border-amber-200/90 dark:border-amber-400/30">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <MailWarning className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300">
                    Email Verification Required
                  </p>
                  <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                    Confirm your email to unlock {user.companyName}
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Workspace features are protected until you verify <span className="font-bold text-slate-900 dark:text-white">{user.email}</span>. Click the single-use verification link sent to your inbox (valid for 24 hours). Remember to check your spam or promotions folder if you do not see it within a minute.
                  </p>
                </div>
              </div>

              {verifyBannerMessage && (
                <div
                  role="status"
                  className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30"
                >
                  {verifyBannerMessage}
                </div>
              )}

              {verifyBannerError && (
                <div
                  role="alert"
                  className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
                >
                  {verifyBannerError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleBannerResendVerification}
                  disabled={verifyBannerLoading}
                  className="clay-btn-primary rounded-full px-6 py-3 text-sm font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <Send className="w-4 h-4" />
                  {verifyBannerLoading ? 'Sending Verification Email...' : 'Resend Verification Email'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleRefreshCurrentUser().catch(() => {});
                  }}
                  className="clay-btn-secondary rounded-full px-5 py-3 text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  I&apos;ve Verified — Check Status
                </button>
                <button
                  type="button"
                  onClick={() => setActivePage('settings')}
                  className="clay-btn-secondary rounded-full px-5 py-3 text-xs font-semibold cursor-pointer"
                >
                  Security Settings
                </button>
              </div>
            </section>
          ) : (
            <>
              {activePage === 'dashboard' && (
                <DashboardPage
                  userRole={user.role}
                  onNavigate={navigateToPage}
                  onSelectBrand={(id) => setSelectedBrandId(id)}
                  onSelectSubmission={handleSelectSubmission}
                />
              )}
              {activePage === 'analytics' && (
                <AnalyticsPage
                  userRole={user.role}
                  onNavigate={navigateToPage}
                  onSelectBrand={(id) => setSelectedBrandId(id)}
                  onSelectSubmission={handleSelectSubmission}
                />
              )}
              {activePage === 'guidelines' && (
                <GuidelinesPage
                  userRole={user.role}
                  selectedBrandId={selectedBrandId}
                  onSelectBrand={(id) => setSelectedBrandId(id)}
                  onNavigate={navigateToPage}
                />
              )}
              {activePage === 'submit' && (
                <SubmitPage
                  selectedBrandId={selectedBrandId}
                  onSelectBrand={(id) => setSelectedBrandId(id)}
                  onSubmitted={(subId) => handleSelectSubmission(subId, 'analysis')}
                  onNavigate={navigateToPage}
                />
              )}
              {activePage === 'analysis' && (
                <AnalysisPage
                  selectedSubmissionId={selectedSubmissionId}
                  onSelectSubmission={(id) => setSelectedSubmissionId(id)}
                  onNavigate={navigateToPage}
                />
              )}
              {activePage === 'corrections' && (
                <CorrectionsPage
                  selectedSubmissionId={selectedSubmissionId}
                  onSelectSubmission={(id) => setSelectedSubmissionId(id)}
                  onNavigate={navigateToPage}
                />
              )}
              {activePage === 'review' && (
                <ReviewPage
                  userRole={user.role}
                  selectedSubmissionId={selectedSubmissionId}
                  onSelectSubmission={(id) => setSelectedSubmissionId(id)}
                  onNavigate={navigateToPage}
                />
              )}
              {activePage === 'history' && (
                <HistoryPage
                  onSelectSubmission={handleSelectSubmission}
                  onNavigate={navigateToPage}
                />
              )}
              {activePage === 'settings' && (
                <SettingsPage
                  user={user}
                  theme={theme}
                  sidebarCollapsed={sidebarCollapsed}
                  activeSection={settingsSection}
                  onSectionChange={(section) => navigateToSettings(section)}
                  onSelectTheme={applyTheme}
                  onSetSidebarCollapsed={setSidebarCollapsed}
                  onUserUpdated={(updated) => setUser(updated)}
                  onRefreshUser={handleRefreshCurrentUser}
                  onLogout={handleLogout}
                  onSignedOutAll={handleSignedOutAll}
                />
              )}
              {activePage === 'profile' && (
                <ProfilePage
                  user={user}
                  onNavigate={navigateToPage}
                  onNavigateSettings={navigateToSettings}
                  onUserUpdated={(updated) => setUser(updated)}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Cmd+K Quick Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm flex items-start justify-center pt-20 p-4"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="clay-surface rounded-[28px] max-w-xl w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                autoFocus
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Jump to any audited submission by title or brand..."
                className="clay-well w-full rounded-full pl-11 pr-4 py-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none"
              />
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {filteredQuickResults.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">No matching submissions found.</p>
              ) : (
                filteredQuickResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      handleSelectSubmission(s.id, 'analysis');
                    }}
                    className="w-full text-left clay-well rounded-2xl p-3 flex items-center justify-between gap-3 hover:ring-2 hover:ring-indigo-400/40 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{s.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{s.brand_name}</p>
                    </div>
                    <StatusBadge status={s.status} />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}
