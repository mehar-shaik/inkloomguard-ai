-- InkloomGuard AI — Advanced Visual Brand Detection Migration
-- Strictly additive & idempotent: preserves all existing data, files, and submissions.

CREATE TABLE IF NOT EXISTS brand_visual_guidelines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL,
  brand_id BIGINT NOT NULL UNIQUE,
  accent_colors_json TEXT NOT NULL DEFAULT '[]',
  approved_backgrounds_json TEXT NOT NULL DEFAULT '[]',
  logo_rules_json TEXT NOT NULL DEFAULT '{}',
  typography_rules_json TEXT NOT NULL DEFAULT '{}',
  source_document_id BIGINT REFERENCES guideline_documents(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_brand_visual_brand_company
    FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
  CONSTRAINT fk_brand_visual_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS brand_logo_variants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL,
  brand_id BIGINT NOT NULL,
  label TEXT NOT NULL,
  variant_type TEXT NOT NULL DEFAULT 'secondary',
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  aspect_ratio DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  dominant_colors_json TEXT NOT NULL DEFAULT '[]',
  features_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_logo_variants_brand_company
    FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
  CONSTRAINT fk_logo_variants_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_brand_visual_guidelines_brand_company
  ON brand_visual_guidelines(brand_id, company_id);

CREATE INDEX IF NOT EXISTS idx_brand_logo_variants_brand_company
  ON brand_logo_variants(brand_id, company_id);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS visual_analysis_json TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS visual_image_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_submissions_visual_hash
  ON submissions(company_id, brand_id, visual_image_hash);
