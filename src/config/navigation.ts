import type React from 'react';
import {
  LayoutDashboard,
  BarChart3,
  BookOpen,
  FilePlus2,
  ShieldCheck,
  GitCompareArrows,
  CheckSquare,
  History,
  Settings,
} from 'lucide-react';
import type { PageKey, SettingsSection } from '../types';

export interface NavItemConfig {
  key: PageKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const SIDEBAR_NAV_ITEMS: NavItemConfig[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'analytics', label: 'Governance Analytics', icon: BarChart3 },
  { key: 'guidelines', label: 'Brand Guidelines', icon: BookOpen },
  { key: 'submit', label: 'Submit Content', icon: FilePlus2 },
  { key: 'analysis', label: 'Analysis Results', icon: ShieldCheck },
  { key: 'corrections', label: 'Correction Suggestions', icon: GitCompareArrows },
  { key: 'review', label: 'Review & Approval', icon: CheckSquare },
  { key: 'history', label: 'Review History', icon: History },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export const VALID_PAGE_KEYS = new Set<PageKey>([
  ...SIDEBAR_NAV_ITEMS.map((item) => item.key),
  'profile',
]);

export const VALID_SETTINGS_SECTIONS = new Set<SettingsSection>([
  'account',
  'profile',
  'appearance',
  'security',
  'notifications',
  'organization',
]);

export function getPageTitle(page: PageKey, settingsSection?: SettingsSection | null): string {
  if (page === 'profile') return 'Profile';
  if (page === 'settings') {
    if (settingsSection === 'account') return 'Account Settings';
    if (settingsSection === 'profile') return 'Profile Settings';
    if (settingsSection === 'appearance') return 'Appearance Settings';
    if (settingsSection === 'security') return 'Security Settings';
    if (settingsSection === 'notifications') return 'Notifications & Preferences';
    if (settingsSection === 'organization') return 'Organization & Workspace';
    return 'Settings';
  }
  const match = SIDEBAR_NAV_ITEMS.find((item) => item.key === page);
  return match ? match.label : 'Dashboard';
}
