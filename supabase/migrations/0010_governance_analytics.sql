-- InkloomGuard AI — Governance Analytics Dashboard Migration
-- Strictly additive & idempotent: preserves all existing data, files, and submissions.

CREATE TABLE IF NOT EXISTS analysis_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL,
  brand_id BIGINT NOT NULL,
  submission_id BIGINT NOT NULL,
  triggered_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  run_type TEXT NOT NULL DEFAULT 'initial' CHECK (run_type IN ('initial', 'reanalysis')),
  compliance_score INTEGER CHECK (compliance_score IS NULL OR (compliance_score >= 0 AND compliance_score <= 100)),
  total_issues INTEGER NOT NULL DEFAULT 0,
  visual_issues INTEGER NOT NULL DEFAULT 0,
  text_issues INTEGER NOT NULL DEFAULT 0,
  ai_status TEXT NOT NULL DEFAULT 'completed',
  outcome_status TEXT NOT NULL DEFAULT 'analyzed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_analysis_runs_submission_company
    FOREIGN KEY (submission_id, company_id) REFERENCES submissions(id, company_id) ON DELETE CASCADE,
  CONSTRAINT fk_analysis_runs_brand_company
    FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
  CONSTRAINT fk_analysis_runs_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_company_created
  ON analysis_runs(company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_submission_company
  ON analysis_runs(submission_id, company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_submissions_company_brand_created
  ON submissions(company_id, brand_id, created_at);

CREATE INDEX IF NOT EXISTS idx_submissions_company_submitter_created
  ON submissions(company_id, submitted_by, created_at);

CREATE INDEX IF NOT EXISTS idx_review_events_company_decision_created
  ON review_events(company_id, decision, created_at);

CREATE INDEX IF NOT EXISTS idx_compliance_issues_company_resolution
  ON compliance_issues(company_id, resolution_status, category);
