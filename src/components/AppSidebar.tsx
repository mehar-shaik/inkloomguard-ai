import React, { useEffect } from 'react';
import { LogOut, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import type { AuthUser, PageKey } from '../types';
import { SIDEBAR_NAV_ITEMS } from '../config/navigation';
import { formatUserRoleLabel, getUserInitials } from '../utils/roles';
import shieldEmblem from '/src/assets/images/inkloom_shield_emblem_1794725371250.jpg';

export function AppSidebar({
  user,
  activePage,
  collapsed,
  mobileOpen,
  onSelectPage,
  onToggleCollapse,
  onCloseMobile,
  onLogout,
}: {
  user: AuthUser;
  activePage: PageKey;
  collapsed: boolean;
  mobileOpen: boolean;
  onSelectPage: (page: PageKey) => void;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onLogout: () => void;
}) {
  const roleLabel = formatUserRoleLabel(user.role);
  const orgInitials = getUserInitials(user.companyName);

  useEffect(() => {
    if (!mobileOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCloseMobile();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const showLabels = !collapsed || mobileOpen;

  return (
    <>
      {mobileOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-slate-950/45 transition-opacity duration-200 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        aria-label="Workspace sidebar"
        className={`fixed lg:sticky top-3 sm:top-4 lg:top-6 left-3 sm:left-4 lg:left-0 z-50 lg:z-10 h-[calc(100vh-1.5rem)] sm:h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)] shrink-0 rounded-[30px] flex flex-col justify-between bg-white/95 dark:bg-[#18113c]/95 border border-white/85 dark:border-violet-400/25 shadow-[0_20px_35px_-8px_rgba(99,102,241,0.14),0_8px_16px_-4px_rgba(148,163,184,0.18)] dark:shadow-[0_14px_34px_-6px_rgba(0,0,0,0.68)] transition-[transform,width] duration-200 ease-out overflow-hidden ${
          collapsed ? 'w-72 max-w-[85vw] lg:w-[88px] p-5 lg:p-3.5' : 'w-72 max-w-[85vw] lg:w-64 p-5'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-[120%] lg:translate-x-0'}`}
      >
        <div className="space-y-5 overflow-y-auto overflow-x-hidden pr-0.5">
          {/* Brand Lockup + Collapse Toggle */}
          <div
            className={`flex items-center gap-2.5 ${
              showLabels ? 'justify-between px-1' : 'flex-col justify-center'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onSelectPage('dashboard');
                onCloseMobile();
              }}
              title="InkloomGuard AI Dashboard"
              className="flex items-center gap-3 min-w-0 text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 cursor-pointer"
            >
              <img
                src={shieldEmblem}
                alt="InkloomGuard AI Shield"
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-2xl object-cover shadow-md border border-white/80 dark:border-violet-400/30 shrink-0"
              />
              {showLabels && (
                <span className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
                  InkloomGuard AI
                </span>
              )}
            </button>

            {/* Desktop Collapse / Expand Toggle */}
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand sidebar navigation' : 'Collapse sidebar navigation'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:inline-flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 dark:text-slate-300 hover:bg-indigo-50/80 dark:hover:bg-violet-900/40 hover:text-indigo-700 dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 shrink-0 cursor-pointer"
            >
              {collapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>

            {/* Mobile / Tablet Close Drawer Button */}
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close navigation"
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 dark:text-slate-300 hover:bg-indigo-50/80 dark:hover:bg-violet-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 shrink-0 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Primary Navigation Links */}
          <nav className="space-y-1.5" aria-label="Primary Navigation">
            {SIDEBAR_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onSelectPage(item.key);
                    onCloseMobile();
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.label}
                  title={!showLabels ? item.label : undefined}
                  className={`w-full min-h-[42px] flex items-center rounded-full text-sm font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 ${
                    showLabels ? 'gap-3 px-4 py-2.5 justify-start' : 'justify-center px-0 py-2.5'
                  } ${
                    isActive
                      ? 'clay-btn-primary'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-indigo-50/75 dark:hover:bg-violet-900/35 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {showLabels && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Workspace Identity & Sign Out */}
        <div className="space-y-3 pt-4 border-t border-slate-200/70 dark:border-violet-400/20">
          {showLabels ? (
            <div className="clay-well rounded-2xl p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Organization
              </p>
              <p className="text-xs font-extrabold text-slate-900 dark:text-white truncate mt-0.5">
                {user.companyName}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                Role: {roleLabel}
              </p>
            </div>
          ) : (
            <div
              title={`${user.companyName} · Role: ${roleLabel}`}
              className="clay-well rounded-2xl py-2.5 flex items-center justify-center"
            >
              <span className="text-xs font-extrabold text-indigo-700 dark:text-violet-200 select-none">
                {orgInitials}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              onCloseMobile();
              onLogout();
            }}
            aria-label="Sign Out"
            title={!showLabels ? 'Sign Out' : undefined}
            className={`clay-btn-secondary w-full min-h-[40px] rounded-full text-xs font-bold flex items-center justify-center gap-2 text-red-700 dark:text-rose-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 ${
              showLabels ? 'px-4 py-2.5' : 'px-0 py-2.5'
            }`}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {showLabels && <span>Sign Out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
