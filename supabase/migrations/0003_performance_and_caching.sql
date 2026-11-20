-- InkloomGuard AI — Guideline Caching, Idempotency & Analysis Timing Metadata
-- Non-destructive additive migration preserving all existing rows.

ALTER TABLE guideline_documents ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE guideline_documents ADD COLUMN IF NOT EXISTS extracted_rules_json TEXT;
ALTER TABLE guideline_documents ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_guideline_docs_hash
  ON guideline_documents(company_id, brand_id, content_hash);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS request_idempotency_key TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS content_hash TEXT;
-- Retained non-destructively for backward compatibility; canonical execution state is submissions.ai_status
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS analysis_stage TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS analysis_timings_json TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_company_idempotency
  ON submissions(company_id, request_idempotency_key)
  WHERE request_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_company_content_hash
  ON submissions(company_id, brand_id, content_hash);
