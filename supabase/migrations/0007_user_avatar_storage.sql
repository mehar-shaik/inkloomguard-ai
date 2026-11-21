-- InkloomGuard AI — User Avatar Storage & Profile Integrity Migration
-- Strictly additive & idempotent: preserves all existing companies, users, stored_files, and tenant assets.

-- 1. Ensure user profile columns exist on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_filename TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_original_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Ensure stored_files supports user-owned avatars alongside brand/submission assets
ALTER TABLE stored_files ALTER COLUMN brand_id DROP NOT NULL;
ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS user_id BIGINT;

UPDATE stored_files sf
SET user_id = NULL
WHERE user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = sf.user_id AND u.company_id = sf.company_id
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stored_files_user_company') THEN
    ALTER TABLE stored_files
      ADD CONSTRAINT fk_stored_files_user_company
      FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stored_files_user ON stored_files(user_id);
CREATE INDEX IF NOT EXISTS idx_stored_files_company_user ON stored_files(company_id, user_id);

-- 3. Safely update stored_files asset ownership CHECK constraint to allow user_avatar
ALTER TABLE stored_files DROP CONSTRAINT IF EXISTS chk_stored_files_asset_ownership;
ALTER TABLE stored_files
  ADD CONSTRAINT chk_stored_files_asset_ownership CHECK (
    (asset_kind = 'brand_logo' AND brand_id IS NOT NULL AND submission_id IS NULL AND guideline_document_id IS NULL AND user_id IS NULL) OR
    (asset_kind = 'guideline_document' AND brand_id IS NOT NULL AND guideline_document_id IS NOT NULL AND submission_id IS NULL AND user_id IS NULL) OR
    (asset_kind IN ('submission_document', 'submission_image') AND brand_id IS NOT NULL AND submission_id IS NOT NULL AND guideline_document_id IS NULL AND user_id IS NULL) OR
    (asset_kind = 'user_avatar' AND user_id IS NOT NULL AND brand_id IS NULL AND submission_id IS NULL AND guideline_document_id IS NULL)
  );
