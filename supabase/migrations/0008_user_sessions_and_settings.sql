-- InkloomGuard AI — User Sessions Tracking & Settings Preferences Migration
-- Strictly additive & idempotent: preserves all existing data, tokens, and assets.

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  company_id BIGINT NOT NULL,
  jti TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  user_agent TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at BIGINT NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT fk_user_sessions_user_company
    FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
  CONSTRAINT fk_user_sessions_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_company_active
  ON user_sessions(user_id, company_id, revoked_at, expires_at);
