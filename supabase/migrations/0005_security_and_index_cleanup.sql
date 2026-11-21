-- InkloomGuard AI — Security Audit Index & Tenant Lookup Hardening
-- Strictly non-destructive & idempotent: never drops tables, columns, or existing rows.
-- Drops redundant duplicate B-tree indexes already enforced by UNIQUE(token_hash)
-- and adds tenant-scoped composite indexes for token & stored-file lookups.

DROP INDEX IF EXISTS idx_password_reset_tokens_hash;
DROP INDEX IF EXISTS idx_email_verification_tokens_hash;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_tenant_expires
  ON password_reset_tokens(user_id, company_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_tenant_expires
  ON email_verification_tokens(user_id, company_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_stored_files_company_user
  ON stored_files(company_id, user_id);
