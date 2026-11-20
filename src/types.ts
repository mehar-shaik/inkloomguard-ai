export type PageKey =
  | 'dashboard'
  | 'guidelines'
  | 'submit'
  | 'analysis'
  | 'corrections'
  | 'review'
  | 'history'
  | 'settings';

export interface AuthUser {
  id: number;
  companyId: number;
  companyName: string;
  name: string;
  email: string;
  role: string;
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
  verificationRequired?: boolean;
  passwordUpdatedAt?: string | null;
  tokenVersion?: number;
}

export interface Brand {
  id: number;
  company_id: number;
  name: string;
  industry: string;
  primary_color: string;
  secondary_color: string;
  logo_filename: string | null;
  logo_original_name: string | null;
  created_at: string;
  factsCount?: number;
  terminologyCount?: number;
  submissionsCount?: number;
}

export interface GuidelineDocument {
  id: number;
  brand_id: number;
  filename: string;
  original_name: string;
  file_type: string;
  extracted_text: string;
  page_count?: number | null;
  extraction_status?: 'pending' | 'completed' | 'failed';
  extraction_error?: string | null;
  extracted_at?: string | null;
  created_at: string;
}

export interface ApprovedFact {
  id: number;
  brand_id: number;
  fact_key: string;
  fact_value: string;
  source_doc: string;
  source_document_id?: number | null;
  source_page?: number | null;
  source_section?: string;
  source_excerpt?: string;
  created_at: string;
}

export interface TerminologyRule {
  id: number;
  brand_id: number;
  prohibited_term: string;
  preferred_term: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  notes: string;
  source_document_id?: number | null;
  source_page?: number | null;
  source_section?: string;
  source_excerpt?: string;
}

export interface ExtractedFactProposal {
  fact_key: string;
  fact_value: string;
  source_page?: number | null;
  source_section?: string;
  source_excerpt?: string;
}

export interface ExtractedTerminologyProposal {
  prohibited_term: string;
  preferred_term: string;
  severity: string;
  notes: string;
  source_page?: number | null;
  source_section?: string;
  source_excerpt?: string;
}

export interface ExtractedGuidelinesPayload {
  toneRules: string;
  messagingRules: string;
  facts: ExtractedFactProposal[];
  terminology: ExtractedTerminologyProposal[];
}

export interface GuidelineConflict {
  type: 'fact_conflict' | 'terminology_conflict';
  key: string;
  existingValue: string;
  incomingValue: string;
  message: string;
}

export interface BrandRules {
  tone_rules: string;
  messaging_rules: string;
  source_document_id?: number | null;
  updated_at?: string;
}

export interface CheckAreaSummary {
  area:
    | 'Brand Tone'
    | 'Terminology'
    | 'Brand Messaging'
    | 'Facts'
    | 'Promotional Claims'
    | 'Visual Identity'
    | 'Accessibility'
    | 'Governance';
  status: 'passed' | 'issues_found' | 'warning' | 'not_performed';
  summary: string;
}

export interface ImageMetrics {
  width: number;
  height: number;
  dominantColors: string[];
  averageLuminance: number;
  contrastSpread: number;
  wcagContrastRatio?: number | null;
  wcagAA?: boolean | null;
  wcagAALarge?: boolean | null;
  wcagAAA?: boolean | null;
  brandPrimaryMatchDistance: number | null;
  brandSecondaryMatchDistance: number | null;
  closestBrandHexMatch: string | null;
}

export interface Submission {
  id: number;
  company_id: number;
  brand_id: number;
  brand_name?: string;
  brand_primary_color?: string;
  brand_secondary_color?: string;
  brand_logo_filename?: string | null;
  submitted_by: number;
  submitted_by_name?: string;
  title: string;
  input_type: string;
  original_content: string;
  revised_content: string;
  file_filename: string | null;
  file_original_name: string | null;
  image_filename: string | null;
  image_alt_text: string;
  status: string;
  compliance_score?: number | null;
  analysis_coverage?: number | null;
  ai_status?: 'completed' | 'partial' | 'failed' | 'pending';
  ai_error?: string | null;
  checks_summary_json: string;
  image_metrics_json: string | null;
  total_issues?: number;
  open_issues?: number;
  latest_decision?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplianceIssue {
  id: number;
  submission_id: number;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  original_text: string;
  explanation: string;
  evidence: string;
  suggested_correction: string;
  resolution_status: 'open' | 'accepted' | 'rejected';
  created_at: string;
}

export interface Revision {
  id: number;
  submission_id: number;
  edited_by: number;
  editor_name?: string;
  content: string;
  note: string;
  created_at: string;
}

export interface ReviewEvent {
  id: number;
  submission_id: number;
  reviewer_id: number;
  reviewer_name: string;
  decision: string;
  comment: string;
  previous_status?: string | null;
  new_status?: string | null;
  created_at: string;
}

export interface DashboardData {
  metrics: {
    totalSubmissions: number;
    issuesFound: number;
    pendingReviews: number;
    approvedContent: number;
  };
  brands: Brand[];
  recentActivity: Array<{
    id: number;
    submission_id: number;
    reviewer_name: string;
    decision: string;
    comment: string;
    previous_status?: string | null;
    new_status?: string | null;
    created_at: string;
    submission_title: string;
    brand_name: string;
  }>;
}
