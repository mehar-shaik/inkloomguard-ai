import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  FilePlus2,
  ShieldCheck,
  GitCompareArrows,
  CheckSquare,
  History,
  LogOut,
  Search,
  Menu,
  X,
} from 'lucide-react';
import {
  api,
  clearAuthToken,
  getAuthToken,
  setAuthToken,
  setUnauthorizedHandler,
} from './api';
import type { AuthUser, PageKey, Submission } from './types';
import { LoadingPanel, StatusBadge, ThemeToggle } from './components/ClayUI';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { GuidelinesPage } from './pages/GuidelinesPage';
import { SubmitPage } from './pages/SubmitPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { CorrectionsPage } from './pages/CorrectionsPage';
import { ReviewPage } from './pages/ReviewPage';
import { HistoryPage } from './pages/HistoryPage';
import shieldEmblem from '/src/assets/images/inkloom_shield_emblem_1794725371250.jpg';
import userAvatar from '/src/assets/images/avatar_compliance_lead_1794725371926.jpg';

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'guidelines', label: 'Brand Guidelines', icon: BookOpen },
  { key: 'submit', label: 'Submit Content', icon: FilePlus2 },
  { key: 'analysis', label: 'Analysis Results', icon: ShieldCheck },
  { key: 'corrections', label: 'Correction Suggestions', icon: GitCompareArrows },
  { key: 'review', label: 'Review & Approval', icon: CheckSquare },
  { key: 'history', label: 'Review History', icon: History },
];

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionNotice, setSessionNotice] = useState('');
  const [activePage, setActivePage] = useState<PageKey>('dashboard');
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
    setUnauthorizedHandler((msg) => {
      setUser(null);
      setSelectedBrandId(null);
      setSelectedSubmissionId(null);
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
        if (user) openQuickSearch();
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user]);

  async function openQuickSearch() {
    setSearchOpen(true);
    setSearchText('');
    try {
      const res = await api.getSubmissions();
      setSearchResults(res.submissions);
    } catch {
      setSearchResults([]);
    }
  }

  async function handleAuthSuccess(token: string) {
    setAuthToken(token);
    setCheckingSession(true);
    try {
      const verified = await api.me();
      setUser(verified.user);
      setSessionNotice('');
      setActivePage('dashboard');
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
  }

  function handleSelectSubmission(submissionId: number, page: PageKey) {
    setSelectedSubmissionId(submissionId);
    setActivePage(page);
    setMobileNavOpen(false);
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <LoadingPanel label="Verifying InkloomGuard AI session..." />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthPage
        onAuthSuccess={handleAuthSuccess}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
        sessionNotice={sessionNotice}
      />
    );
  }

  const currentNav = NAV_ITEMS.find((item) => item.key === activePage) || NAV_ITEMS[0];
  const filteredQuickResults = searchResults.filter(
    (s) =>
      !searchText.trim() ||
      s.title.toLowerCase().includes(searchText.toLowerCase()) ||
      (s.brand_name || '').toLowerCase().includes(searchText.toLowerCase())
  );

  return (
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

      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Claymorphic Sidebar Rail */}
      <aside
        className={`fixed lg:sticky top-4 lg:top-6 left-4 z-50 lg:z-10 h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)] w-64 shrink-0 clay-surface rounded-[30px] p-5 flex flex-col justify-between transition-transform duration-200 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-[120%] lg:translate-x-0'
        }`}
      >
        <div className="space-y-7">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={shieldEmblem}
                alt="InkloomGuard AI Shield"
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-2xl object-cover shadow-md border border-white/80 dark:border-violet-400/30 shrink-0"
              />
              <span className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
                InkloomGuard AI
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="lg:hidden p-1.5 text-slate-500 dark:text-slate-300 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="space-y-1.5" aria-label="Primary Navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setActivePage(item.key);
                    setMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-full text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'clay-btn-primary'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-indigo-50/70 dark:hover:bg-violet-900/30 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 pt-4 border-t border-slate-200/70 dark:border-violet-400/20">
          <div className="clay-well rounded-2xl p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Organization</p>
            <p className="text-xs font-extrabold text-slate-900 dark:text-white truncate mt-0.5">
              {user.companyName}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 capitalize mt-0.5">Role: {user.role}</p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="clay-btn-secondary w-full rounded-full px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-2 text-red-700 dark:text-rose-300 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col gap-6 relative z-10">
        {/* Global Top Header */}
        <header className="clay-surface rounded-[26px] px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden clay-btn-secondary rounded-full p-2 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-400 truncate">
                InkloomGuard AI / {user.companyName}
              </p>
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={openQuickSearch}
              className="clay-well rounded-full px-3.5 py-2 text-xs text-slate-500 dark:text-slate-300 hidden md:inline-flex items-center gap-3 cursor-pointer hover:ring-2 hover:ring-indigo-400/40"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search audits...</span>
              <kbd className="font-mono-tabular text-[10px] px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-800 text-slate-500 dark:text-slate-300">
                ⌘K
              </kbd>
            </button>

            <ThemeToggle
              theme={theme}
              onToggle={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
            />

            <div className="flex items-center gap-2.5 pl-1">
              <img
                src={userAvatar}
                alt={user.name}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover border border-white/80 dark:border-violet-400/30 shadow-xs"
              />
              <div className="hidden sm:block text-left leading-tight">
                <p className="text-xs font-bold text-slate-900 dark:text-white">{user.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 capitalize">{user.role}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Active Page Viewport */}
        <main className="flex-1 pb-6">
          {activePage === 'dashboard' && (
            <DashboardPage
              userRole={user.role}
              onNavigate={setActivePage}
              onSelectBrand={(id) => setSelectedBrandId(id)}
              onSelectSubmission={handleSelectSubmission}
            />
          )}
          {activePage === 'guidelines' && (
            <GuidelinesPage
              selectedBrandId={selectedBrandId}
              onSelectBrand={(id) => setSelectedBrandId(id)}
              onNavigate={setActivePage}
            />
          )}
          {activePage === 'submit' && (
            <SubmitPage
              selectedBrandId={selectedBrandId}
              onSelectBrand={(id) => setSelectedBrandId(id)}
              onSubmitted={(subId) => handleSelectSubmission(subId, 'analysis')}
              onNavigate={setActivePage}
            />
          )}
          {activePage === 'analysis' && (
            <AnalysisPage
              selectedSubmissionId={selectedSubmissionId}
              onSelectSubmission={(id) => setSelectedSubmissionId(id)}
              onNavigate={setActivePage}
            />
          )}
          {activePage === 'corrections' && (
            <CorrectionsPage
              selectedSubmissionId={selectedSubmissionId}
              onSelectSubmission={(id) => setSelectedSubmissionId(id)}
              onNavigate={setActivePage}
            />
          )}
          {activePage === 'review' && (
            <ReviewPage
              userRole={user.role}
              selectedSubmissionId={selectedSubmissionId}
              onSelectSubmission={(id) => setSelectedSubmissionId(id)}
              onNavigate={setActivePage}
            />
          )}
          {activePage === 'history' && (
            <HistoryPage
              onSelectSubmission={handleSelectSubmission}
              onNavigate={setActivePage}
            />
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
  );
}
