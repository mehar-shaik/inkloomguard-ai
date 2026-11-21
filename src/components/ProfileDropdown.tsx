import React, { useEffect, useId, useRef, useState } from 'react';
import {
  ChevronDown,
  LogOut,
  MailCheck,
  MailWarning,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  User,
} from 'lucide-react';
import type { AuthUser, PageKey, SettingsSection } from '../types';
import { formatUserRoleLabel } from '../utils/roles';
import { UserAvatar } from './UserAvatar';

export function ProfileDropdown({
  user,
  theme,
  activePage,
  settingsSection,
  onToggleTheme,
  onOpenProfile,
  onOpenAccountSettings,
  onOpenSecurity,
  onLogout,
}: {
  user: AuthUser;
  theme: 'light' | 'dark';
  activePage: PageKey;
  settingsSection: SettingsSection | null;
  onToggleTheme: () => void;
  onOpenProfile: () => void;
  onOpenAccountSettings: () => void;
  onOpenSecurity: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const triggerId = useId();
  const menuId = useId();
  const roleLabel = formatUserRoleLabel(user.role);

  // Close automatically when navigating to another page or section
  useEffect(() => {
    setOpen(false);
  }, [activePage, settingsSection]);

  // Close on outside click or Escape key
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function focusMenuItem(index: number) {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    const wrapped = ((index % items.length) + items.length) % items.length;
    items[wrapped]?.focus();
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => {
        focusMenuItem(e.key === 'ArrowUp' ? -1 : 0);
      });
    }
  }

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []
    );
    if (items.length === 0) return;
    const currentIndex = items.findIndex((el) => el === document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusMenuItem(currentIndex < 0 ? 0 : currentIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusMenuItem(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusMenuItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusMenuItem(items.length - 1);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const itemBaseClass =
    'w-full min-h-[40px] flex items-center justify-between gap-3 px-3.5 py-2 rounded-2xl text-xs font-semibold transition-colors duration-150 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400';

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        className={`flex items-center gap-2.5 pl-1 pr-2.5 py-1 rounded-full text-left transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 ${
          open
            ? 'bg-indigo-50/90 dark:bg-violet-900/45 ring-1 ring-indigo-200/80 dark:ring-violet-400/35'
            : 'hover:bg-indigo-50/70 dark:hover:bg-violet-900/30'
        }`}
      >
        <UserAvatar user={user} size="sm" />
        <div className="hidden sm:block text-left leading-tight max-w-[140px]">
          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{user.name}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{roleLabel}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-300 shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 mt-2.5 w-72 max-w-[calc(100vw-1.5rem)] rounded-[24px] p-2.5 z-50 bg-white dark:bg-[#18113c] border border-indigo-100/90 dark:border-violet-400/30 shadow-[0_20px_44px_-10px_rgba(49,46,129,0.22),0_8px_18px_-4px_rgba(15,23,42,0.12)] dark:shadow-[0_22px_48px_-8px_rgba(0,0,0,0.78)] origin-top-right animate-[fadeIn_140ms_ease-out]"
        >
          {/* User Identity Summary */}
          <div className="p-3 rounded-2xl bg-indigo-50/70 dark:bg-[#110b2e] border border-indigo-100/70 dark:border-violet-400/20 mb-2">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar user={user} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                  {user.name}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{user.email}</p>
              </div>
            </div>
            <div className="mt-2.5 pt-2 border-t border-indigo-200/60 dark:border-violet-400/20 flex items-center justify-between gap-2 text-[11px]">
              <span className="font-bold text-indigo-700 dark:text-violet-300 truncate">
                {roleLabel} · {user.companyName}
              </span>
              <span
                className={`inline-flex items-center gap-1 font-semibold shrink-0 ${
                  user.emailVerified
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {user.emailVerified ? (
                  <>
                    <MailCheck className="w-3 h-3" />
                    Verified
                  </>
                ) : (
                  <>
                    <MailWarning className="w-3 h-3" />
                    Unverified
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Navigation & Account Actions */}
          <div className="space-y-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenProfile();
              }}
              className={`${itemBaseClass} ${
                activePage === 'profile'
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-violet-900/50 dark:text-white'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-indigo-50/80 dark:hover:bg-violet-900/35 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 whitespace-nowrap">
                <User className="w-4 h-4 text-indigo-600 dark:text-violet-300 shrink-0" />
                <span>Profile</span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenAccountSettings();
              }}
              className={`${itemBaseClass} ${
                activePage === 'settings' && settingsSection === 'account'
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-violet-900/50 dark:text-white'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-indigo-50/80 dark:hover:bg-violet-900/35 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 whitespace-nowrap">
                <Settings className="w-4 h-4 text-indigo-600 dark:text-violet-300 shrink-0" />
                <span>Account Settings</span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenSecurity();
              }}
              className={`${itemBaseClass} ${
                activePage === 'settings' && settingsSection === 'security'
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-violet-900/50 dark:text-white'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-indigo-50/80 dark:hover:bg-violet-900/35 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 whitespace-nowrap">
                <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-violet-300 shrink-0" />
                <span>Security</span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onToggleTheme();
              }}
              className={`${itemBaseClass} text-slate-700 dark:text-slate-200 hover:bg-indigo-50/80 dark:hover:bg-violet-900/35 hover:text-slate-900 dark:hover:text-white`}
            >
              <span className="flex items-center gap-2.5 whitespace-nowrap">
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <Moon className="w-4 h-4 text-indigo-600 shrink-0" />
                )}
                <span>Appearance</span>
              </span>
              <span className="text-[11px] font-bold text-indigo-600 dark:text-violet-300 whitespace-nowrap">
                {theme === 'dark' ? 'Dark Clay' : 'Light Clay'}
              </span>
            </button>
          </div>

          <div className="my-1.5 border-t border-slate-200/80 dark:border-violet-400/20" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className={`${itemBaseClass} text-red-700 dark:text-rose-300 hover:bg-red-50/90 dark:hover:bg-rose-500/15`}
          >
            <span className="flex items-center gap-2.5 whitespace-nowrap">
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Sign Out</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
