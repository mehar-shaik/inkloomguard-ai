-- InkloomGuard AI — Round 3 Phase 1 Safe Additive Schema Migration
-- Strictly additive & idempotent: never drops tables, never truncates, never deletes existing rows.

-- 1. Profile & preference fields on users (preparation for Round 3 profile/settings phases)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_filename TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_original_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Allow stored_files to hold non-brand assets such as user avatars
ALTER TABLE stored_files ALTER COLUMN brand_id DROP NOT NULL;
ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_stored_files_user ON stored_files(user_id);

-- 3. Submission AI execution state & compliance score persistence
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS compliance_score INTEGER;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ai_status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ai_error TEXT;

-- 4. Analytics query performance indexes
CREATE INDEX IF NOT EXISTS idx_submissions_company_status_created ON submissions(company_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_issues_company_category_severity ON compliance_issues(company_id, category, severity);
