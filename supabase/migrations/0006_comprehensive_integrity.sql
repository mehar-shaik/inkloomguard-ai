-- InkloomGuard AI — Comprehensive Schema Integrity, Provenance, Composite Tenant FKs & Audit Columns
-- Non-destructive & idempotent: preserves all existing companies, users, brands, guidelines, submissions, revisions, and reviews.

-- 1. Provenance & extraction metadata on guideline tables
ALTER TABLE guideline_documents ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE guideline_documents ADD COLUMN IF NOT EXISTS extraction_error TEXT;
ALTER TABLE guideline_documents ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 1;

UPDATE guideline_documents
SET extraction_status = 'completed'
WHERE extracted_rules_json IS NOT NULL AND extraction_status = 'pending';

ALTER TABLE approved_facts ADD COLUMN IF NOT EXISTS source_document_id BIGINT REFERENCES guideline_documents(id) ON DELETE SET NULL;
ALTER TABLE approved_facts ADD COLUMN IF NOT EXISTS source_page INTEGER;
ALTER TABLE approved_facts ADD COLUMN IF NOT EXISTS source_section TEXT NOT NULL DEFAULT '';
ALTER TABLE approved_facts ADD COLUMN IF NOT EXISTS source_excerpt TEXT NOT NULL DEFAULT '';

ALTER TABLE terminology_rules ADD COLUMN IF NOT EXISTS source_document_id BIGINT REFERENCES guideline_documents(id) ON DELETE SET NULL;
ALTER TABLE terminology_rules ADD COLUMN IF NOT EXISTS source_page INTEGER;
ALTER TABLE terminology_rules ADD COLUMN IF NOT EXISTS source_section TEXT NOT NULL DEFAULT '';
ALTER TABLE terminology_rules ADD COLUMN IF NOT EXISTS source_excerpt TEXT NOT NULL DEFAULT '';

ALTER TABLE brand_rules ADD COLUMN IF NOT EXISTS source_document_id BIGINT REFERENCES guideline_documents(id) ON DELETE SET NULL;

-- 2. Coverage & distributed reanalysis lock metadata on submissions, status transition tracking on review_events
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS analysis_coverage INTEGER;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reanalysis_started_at TIMESTAMPTZ;

ALTER TABLE review_events ADD COLUMN IF NOT EXISTS previous_status TEXT NOT NULL DEFAULT '';
ALTER TABLE review_events ADD COLUMN IF NOT EXISTS new_status TEXT NOT NULL DEFAULT '';

-- 3. Safely make audit user reference columns nullable before enforcing ON DELETE SET NULL foreign keys
ALTER TABLE guideline_documents ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE revisions ALTER COLUMN edited_by DROP NOT NULL;
ALTER TABLE review_events ALTER COLUMN reviewer_id DROP NOT NULL;

UPDATE guideline_documents g
SET uploaded_by = NULL
WHERE uploaded_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.uploaded_by);

UPDATE revisions r
SET edited_by = NULL
WHERE edited_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.edited_by);

UPDATE review_events re
SET reviewer_id = NULL
WHERE reviewer_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = re.reviewer_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_guideline_docs_uploaded_by') THEN
    ALTER TABLE guideline_documents
      ADD CONSTRAINT fk_guideline_docs_uploaded_by
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_revisions_edited_by') THEN
    ALTER TABLE revisions
      ADD CONSTRAINT fk_revisions_edited_by
      FOREIGN KEY (edited_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_review_events_reviewer_id') THEN
    ALTER TABLE review_events
      ADD CONSTRAINT fk_review_events_reviewer_id
      FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Normalize any legacy values safely before attaching CHECK constraints
UPDATE users SET role = 'author' WHERE role NOT IN ('reviewer', 'author');
UPDATE terminology_rules SET severity = 'high' WHERE LOWER(severity) NOT IN ('critical', 'high', 'medium', 'low');
UPDATE terminology_rules SET severity = LOWER(severity) WHERE severity <> LOWER(severity);
UPDATE compliance_issues SET severity = 'medium' WHERE LOWER(severity) NOT IN ('critical', 'high', 'medium', 'low');
UPDATE compliance_issues SET severity = LOWER(severity) WHERE severity <> LOWER(severity);
UPDATE compliance_issues SET resolution_status = 'open' WHERE resolution_status NOT IN ('open', 'accepted', 'rejected');
UPDATE submissions SET status = 'analyzed' WHERE status NOT IN ('analyzed', 'pending_review', 'revision_saved', 'changes_requested', 'approved', 'rejected');
UPDATE submissions SET ai_status = 'completed' WHERE ai_status NOT IN ('completed', 'partial', 'failed', 'pending');
UPDATE submissions SET compliance_score = LEAST(100, GREATEST(0, compliance_score)) WHERE compliance_score IS NOT NULL;
UPDATE submissions SET analysis_coverage = LEAST(100, GREATEST(0, analysis_coverage)) WHERE analysis_coverage IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_role') THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('reviewer', 'author'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_terminology_severity') THEN
    ALTER TABLE terminology_rules ADD CONSTRAINT chk_terminology_severity CHECK (severity IN ('critical', 'high', 'medium', 'low'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_issues_severity') THEN
    ALTER TABLE compliance_issues ADD CONSTRAINT chk_issues_severity CHECK (severity IN ('critical', 'high', 'medium', 'low'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_issues_resolution_status') THEN
    ALTER TABLE compliance_issues ADD CONSTRAINT chk_issues_resolution_status CHECK (resolution_status IN ('open', 'accepted', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_submissions_status') THEN
    ALTER TABLE submissions ADD CONSTRAINT chk_submissions_status CHECK (status IN ('analyzed', 'pending_review', 'revision_saved', 'changes_requested', 'approved', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_submissions_ai_status') THEN
    ALTER TABLE submissions ADD CONSTRAINT chk_submissions_ai_status CHECK (ai_status IN ('completed', 'partial', 'failed', 'pending'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_submissions_score_range') THEN
    ALTER TABLE submissions ADD CONSTRAINT chk_submissions_score_range CHECK (compliance_score IS NULL OR (compliance_score >= 0 AND compliance_score <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_submissions_coverage_range') THEN
    ALTER TABLE submissions ADD CONSTRAINT chk_submissions_coverage_range CHECK (analysis_coverage IS NULL OR (analysis_coverage >= 0 AND analysis_coverage <= 100));
  END IF;
END $$;

-- 5. Composite tenant-integrity unique keys and foreign keys preventing cross-company entity mismatches
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_id_company') THEN
    ALTER TABLE users ADD CONSTRAINT uq_users_id_company UNIQUE (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_brands_id_company') THEN
    ALTER TABLE brands ADD CONSTRAINT uq_brands_id_company UNIQUE (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_guideline_docs_id_company') THEN
    ALTER TABLE guideline_documents ADD CONSTRAINT uq_guideline_docs_id_company UNIQUE (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_submissions_id_company') THEN
    ALTER TABLE submissions ADD CONSTRAINT uq_submissions_id_company UNIQUE (id, company_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_guideline_docs_brand_company') THEN
    ALTER TABLE guideline_documents
      ADD CONSTRAINT fk_guideline_docs_brand_company
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_facts_brand_company') THEN
    ALTER TABLE approved_facts
      ADD CONSTRAINT fk_facts_brand_company
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_terms_brand_company') THEN
    ALTER TABLE terminology_rules
      ADD CONSTRAINT fk_terms_brand_company
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_brand_rules_brand_company') THEN
    ALTER TABLE brand_rules
      ADD CONSTRAINT fk_brand_rules_brand_company
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_submissions_brand_company') THEN
    ALTER TABLE submissions
      ADD CONSTRAINT fk_submissions_brand_company
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_submissions_user_company') THEN
    ALTER TABLE submissions
      ADD CONSTRAINT fk_submissions_user_company
      FOREIGN KEY (submitted_by, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_issues_submission_company') THEN
    ALTER TABLE compliance_issues
      ADD CONSTRAINT fk_issues_submission_company
      FOREIGN KEY (submission_id, company_id) REFERENCES submissions(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_revisions_submission_company') THEN
    ALTER TABLE revisions
      ADD CONSTRAINT fk_revisions_submission_company
      FOREIGN KEY (submission_id, company_id) REFERENCES submissions(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_review_events_submission_company') THEN
    ALTER TABLE review_events
      ADD CONSTRAINT fk_review_events_submission_company
      FOREIGN KEY (submission_id, company_id) REFERENCES submissions(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pw_reset_user_company') THEN
    ALTER TABLE password_reset_tokens
      ADD CONSTRAINT fk_pw_reset_user_company
      FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_email_verify_user_company') THEN
    ALTER TABLE email_verification_tokens
      ADD CONSTRAINT fk_email_verify_user_company
      FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stored_files_brand_company') THEN
    ALTER TABLE stored_files
      ADD CONSTRAINT fk_stored_files_brand_company
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 6. stored_files uniqueness and asset-kind ownership validation (only implemented asset kinds)
CREATE UNIQUE INDEX IF NOT EXISTS idx_stored_files_company_filename_unique
  ON stored_files(company_id, filename);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_stored_files_asset_ownership') THEN
    ALTER TABLE stored_files
      ADD CONSTRAINT chk_stored_files_asset_ownership CHECK (
        (asset_kind = 'brand_logo' AND brand_id IS NOT NULL AND submission_id IS NULL AND guideline_document_id IS NULL) OR
        (asset_kind = 'guideline_document' AND brand_id IS NOT NULL AND guideline_document_id IS NOT NULL AND submission_id IS NULL) OR
        (asset_kind IN ('submission_document', 'submission_image') AND brand_id IS NOT NULL AND submission_id IS NOT NULL AND guideline_document_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_facts_source_doc ON approved_facts(source_document_id);
CREATE INDEX IF NOT EXISTS idx_terms_source_doc ON terminology_rules(source_document_id);
CREATE INDEX IF NOT EXISTS idx_stored_files_submission ON stored_files(submission_id, company_id);
CREATE INDEX IF NOT EXISTS idx_stored_files_guideline_doc ON stored_files(guideline_document_id, company_id);
