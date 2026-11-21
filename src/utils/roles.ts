export interface RolePermissionDetails {
  key: string;
  label: string;
  subtitle: string;
  capabilities: Array<{ label: string; allowed: boolean }>;
}

export function formatUserRoleLabel(role: string | undefined | null): string {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'admin') return 'Admin';
  if (normalized === 'reviewer') return 'Reviewer';
  if (normalized === 'author') return 'Author';
  if (!normalized) return 'Member';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function getRolePermissionDetails(role: string | undefined | null): RolePermissionDetails {
  const normalized = String(role || '').trim().toLowerCase();

  if (normalized === 'admin') {
    return {
      key: 'admin',
      label: 'Admin',
      subtitle: 'Workspace Administrator',
      capabilities: [
        { label: 'Approve, reject, or request changes on submissions', allowed: true },
        { label: 'Create, edit, and delete organization brand profiles', allowed: true },
        { label: 'Manage brand guidelines, approved facts, and terminology rules', allowed: true },
        { label: 'Provision and manage organization team members', allowed: true },
        { label: 'Submit content, run compliance scans, and save revisions', allowed: true },
      ],
    };
  }

  if (normalized === 'reviewer') {
    return {
      key: 'reviewer',
      label: 'Reviewer',
      subtitle: 'Brand Reviewer & Governance',
      capabilities: [
        { label: 'Approve, reject, or request changes on submissions', allowed: true },
        { label: 'Create, edit, and delete organization brand profiles', allowed: true },
        { label: 'Manage brand guidelines, approved facts, and terminology rules', allowed: true },
        { label: 'Provision organization authors and reviewers', allowed: true },
        { label: 'Submit content, run compliance scans, and save revisions', allowed: true },
      ],
    };
  }

  return {
    key: normalized || 'author',
    label: formatUserRoleLabel(normalized || 'author'),
    subtitle: 'Content Contributor',
    capabilities: [
      { label: 'Submit copy, documents, and visuals for compliance analysis', allowed: true },
      { label: 'Resolve flagged findings and save versioned draft revisions', allowed: true },
      { label: 'Post governance comments and inspect review history', allowed: true },
      { label: 'View organization brand profiles and compliance guidelines', allowed: true },
      { label: 'Formal approvals, brand deletion, and guideline rule edits', allowed: false },
    ],
  };
}

export function getUserInitials(name: string | undefined | null, email?: string | null): string {
  const cleanName = String(name || '').trim();
  if (cleanName) {
    const parts = cleanName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return cleanName.slice(0, 2).toUpperCase();
  }
  const cleanEmail = String(email || '').trim();
  if (cleanEmail) {
    return cleanEmail[0].toUpperCase();
  }
  return 'IG';
}
