import React from 'react';
import { Menu, Search } from 'lucide-react';
import type { AuthUser, PageKey, SettingsSection } from '../types';
import { getPageTitle } from '../config/navigation';
import { ThemeToggle } from './ClayUI';
import { ProfileDropdown } from './ProfileDropdown';

export function TopNavHeader({
  user,
  activePage,
  settingsSection,
  theme,
  searchDisabled = false,
  onToggleTheme,
  onOpenMobileNav,
  onOpenQuickSearch,
  onOpenProfile,
  onOpenAccountSettings,
  onOpenSecurity,
  onLogout,
}: {
  user: AuthUser;
  activePage: PageKey;
  settingsSection: SettingsSection | null;
  theme: 'light' | 'dark';
  searchDisabled?: boolean;
  onToggleTheme: () => void;
  onOpenMobileNav: () => void;
  onOpenQuickSearch: () => void;
  onOpenProfile: () => void;
  onOpenAccountSettings: () => void;
  onOpenSecurity: () => void;
  onLogout: () => void;
}) {
  const pageTitle = getPageTitle(activePage, settingsSection);

  return (
    <header className="clay-surface rounded-[26px] px-4 sm:px-5 py-3 flex items-center justify-between gap-3 sm:gap-4 relative z-20">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          className="lg:hidden clay-btn-secondary rounded-full w-10 h-10 inline-flex items-center justify-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-slate-400 truncate">
            InkloomGuard AI / {user.companyName}
          </p>
          <h1 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate">
            {pageTitle}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          type="button"
          onClick={onOpenQuickSearch}
          disabled={searchDisabled}
          aria-label="Search audits"
          title={searchDisabled ? 'Verify your email to search audits' : 'Search audits (Ctrl+K / Cmd+K)'}
          className="clay-well rounded-full px-3 py-2 md:px-3.5 text-xs text-slate-500 dark:text-slate-300 inline-flex items-center gap-2.5 cursor-pointer hover:ring-2 hover:ring-indigo-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">Search audits...</span>
          <kbd className="hidden md:inline font-mono-tabular text-[10px] px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-800 text-slate-500 dark:text-slate-300">
            ⌘K
          </kbd>
        </button>

        <div className="hidden sm:block">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>

        <ProfileDropdown
          user={user}
          theme={theme}
          activePage={activePage}
          settingsSection={settingsSection}
          onToggleTheme={onToggleTheme}
          onOpenProfile={onOpenProfile}
          onOpenAccountSettings={onOpenAccountSettings}
          onOpenSecurity={onOpenSecurity}
          onLogout={onLogout}
        />
      </div>
    </header>
  );
}
