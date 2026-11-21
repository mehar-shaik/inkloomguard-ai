export type PageKey =
  | 'dashboard'
  | 'analytics'
  | 'guidelines'
  | 'submit'
  | 'analysis'
  | 'corrections'
  | 'review'
  | 'history'
  | 'settings'
  | 'profile';

export type SettingsSection =
  | 'account'
  | 'profile'
  | 'appearance'
  | 'security'
  | 'notifications'
  | 'organization';

export type DefaultLandingPage =
  | 'dashboard'
  | 'guidelines'
  | 'submit'
  | 'analysis'
  | 'corrections'
  | 'review'
  | 'history';

export interface UserPreferences {
  emailNotifications: boolean;
  reviewNotifications: boolean;
  complianceAnalysisNotifications: boolean;
  productAccountNotifications: boolean;
  defaultPage: DefaultLandingPage;
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark';
}

export interface UserSessionInfo {
  id: number;
  isCurrent: boolean;
  deviceSummary: string;
  browser: string;
  os: string;
  ipAddress: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
}

export interface OrganizationSummary {
  id: number;
  name: string;
  createdAt: string | null;
  memberCount: number;
  brandCount: number;
  submissionCount: number;
}

export interface TeamMemberSummary {
  id: number;
  name: string;
  email: string;
  role: string;
  jobTitle?: string;
  emailVerified: boolean;
  createdAt: string | null;
}

export interface AuthUser {
  id: number;
  companyId: number;
  companyName: string;
  name: string;
  email: string;
  role: string;
  avatarFilename?: string | null;
  avatarOriginalName?: string | null;
  avatarUrl?: string | null;
  jobTitle?: string;
  bio?: string;
  preferences?: UserPreferences;
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
  verificationRequired?: boolean;
  passwordUpdatedAt?: string | null;
  createdAt?: string | null;
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
  visualGuidelines?: BrandVisualGuidelinesConfig;
}

export type VisualCheckStatus = 'passed' | 'violation' | 'inconclusive' | 'not_applicable';
export type VisualConfidenceLevel = 'high' | 'medium' | 'low';
export type VisualSeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface VisualBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  label?: string;
}

export interface VisualColorSwatch {
  hex: string;
  areaPct: number;
  role: 'primary' | 'secondary' | 'accent' | 'approved_background' | 'neutral' | 'unauthorized' | 'matched_brand';
  closestExpectedHex: string | null;
  closestExpectedRole: string | null;
  deltaE: number | null;
}

export interface BrandLogoRulesConfig {
  logoRequired: boolean | null;
  minWidthPx: number | null;
  clearSpaceRatio: number | null;
  allowedPlacements: string[];
  prohibitedMisuse: string[];
  notes: string;
}

export interface BrandTypographyRulesConfig {
  primaryFont: string;
  secondaryFont: string;
  headingStyle: string;
  bodyStyle: string;
  notes: string;
}

export interface BrandVisualGuidelinesConfig {
  accentColors: string[];
  approvedBackgrounds: string[];
  logoRules: BrandLogoRulesConfig;
  typographyRules: BrandTypographyRulesConfig;
  sourceDocumentId?: number | null;
  updatedAt?: string;
}

export interface BrandLogoVariant {
  id: number;
  brand_id: number;
  label: string;
  variant_type: string;
  filename: string;
  original_name: string;
  width: number;
  height: number;
  aspect_ratio: number;
  dominant_colors: string[];
  created_at: string;
}

export interface VisualCheckResult {
  id:
    | 'logo_matching'
    | 'logo_distortion'
    | 'logo_placement_clear_space'
    | 'brand_colors'
    | 'typography_consistency';
  title: string;
  status: VisualCheckStatus;
  confidence: VisualConfidenceLevel;
  severity: VisualSeverityLevel | null;
  category: string;
  explanation: string;
  evidence: string;
  affectedRegion: VisualBoundingBox | null;
  recommendedCorrection: string;
  referenceUsed?: string | null;
  details?: Record<string, unknown>;
}

export interface VisualDetectionOverlayItem {
  id: string;
  label: string;
  kind: 'matched_logo' | 'logo_violation' | 'clear_space_zone' | 'typography_region' | 'color_region';
  status: VisualCheckStatus;
  confidence: VisualConfidenceLevel;
  bbox: VisualBoundingBox;
  notes: string;
}

export interface VisualBrandAnalysisResult {
  analyzedAt: string;
  imageWidth: number;
  imageHeight: number;
  visionStatus: 'completed' | 'unavailable' | 'failed';
  visionNote: string | null;
  cached?: boolean;
  overallStatus: 'passed' | 'issues_found' | 'warning' | 'not_performed';
  summary: string;
  matchedLogoVariant: {
    id: number | 'primary';
    label: string;
    variantType: string;
    filename: string;
    similarityScore: number;
    detectedAspectRatio: number;
    expectedAspectRatio: number;
    aspectRatioDeviation: number;
    estimatedWidthPx: number;
    estimatedHeightPx: number;
    placementZone: string;
    bbox: VisualBoundingBox;
    backgroundHex: string | null;
    backgroundContrastRatio: number | null;
  } | null;
  expectedPalette: Array<{ hex: string; role: string }>;
  detectedPalette: VisualColorSwatch[];
  referenceLogos: Array<{
    id: number | 'primary';
    label: string;
    variantType: string;
    filename: string;
    width: number;
    height: number;
    aspectRatio: number;
  }>;
  overlays: VisualDetectionOverlayItem[];
  checks: VisualCheckResult[];
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
  visual_analysis_json?: string | null;
  visual_image_hash?: string | null;
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

export type AnalyticsRange = '7d' | '30d' | '90d' | '12m' | 'custom' | 'all';
export type TrendGranularity = 'day' | 'week' | 'month';

export interface AnalyticsQueryParams {
  range?: AnalyticsRange;
  startDate?: string;
  endDate?: string;
  brandId?: number | null;
  category?: string | null;
  status?: string | null;
  page?: number;
  limit?: number;
}

export interface AnalyticsSeverityDistribution {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface AnalyticsOverviewMetrics {
  totalSubmissions: number;
  analyzedSubmissions: number;
  fullyCompliantSubmissions: number;
  submissionsRequiringCorrections: number;
  awaitingReviewCount: number;
  pendingReviewCount: number;
  approvedCount: number;
  rejectedCount: number;
  changesRequestedCount: number;
  complianceRate: number | null;
  previousComplianceRate: number | null;
  complianceRateDelta: number | null;
  averageComplianceScore: number | null;
  openViolationsCount: number;
  resolvedViolationsCount: number;
  totalViolationsCount: number;
  totalAnalysisRuns: number;
  reanalysisRunsCount: number;
}

export interface AnalyticsTrendPoint {
  bucketKey: string;
  label: string;
  startDate: string;
  endDate: string;
  submissionVolume: number;
  analyzedSubmissions: number;
  fullyCompliantCount: number;
  complianceRate: number | null;
  violationVolume: number;
  approvedCount: number;
  rejectedCount: number;
  changesRequestedCount: number;
  analysisRunsCount: number;
  reanalysisCount: number;
}

export interface AnalyticsRecurringViolationItem {
  ruleKey: string;
  ruleName: string;
  category: string;
  subCheckType: string | null;
  occurrences: number;
  affectedSubmissions: number;
  openOccurrences: number;
  resolvedOccurrences: number;
  severityDistribution: AnalyticsSeverityDistribution;
  previousOccurrences: number | null;
  deltaOccurrences: number | null;
  changePct: number | null;
  latestSubmissionId: number | null;
  latestSubmissionTitle: string | null;
  latestBrandId: number | null;
  latestBrandName: string | null;
}

export interface AnalyticsRecurringViolationsPage {
  items: AnalyticsRecurringViolationItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AnalyticsCategoryBreakdownItem {
  category: string;
  issueType: 'visual' | 'text';
  totalCount: number;
  openCount: number;
  resolvedCount: number;
  affectedSubmissions: number;
  sharePct: number | null;
  severityDistribution: AnalyticsSeverityDistribution;
}

export interface AnalyticsVisualSubCheckItem {
  checkId: string;
  title: string;
  violationCount: number;
  passedCount: number;
  inconclusiveCount: number;
  notApplicableCount: number;
  affectedSubmissions: number;
  openIssueCount: number;
}

export interface AnalyticsIssueBreakdown {
  textViolations: number;
  visualViolations: number;
  totalViolations: number;
  textSharePct: number | null;
  visualSharePct: number | null;
  categoryBreakdown: AnalyticsCategoryBreakdownItem[];
  visualSubCheckBreakdown: AnalyticsVisualSubCheckItem[];
}

export interface AnalyticsReviewMetrics {
  pendingReviewCount: number;
  decidedSubmissionsCount: number;
  formalDecisionsCount: number;
  approvedDecisions: number;
  rejectedDecisions: number;
  changesRequestedDecisions: number;
  commentsCount: number;
  reanalyzedEventsCount: number;
  approvalRate: number | null;
  rejectionRate: number | null;
  changesRequestedRate: number | null;
  averageTurnaroundHours: number | null;
  medianTurnaroundHours: number | null;
  turnaroundSampleSize: number;
  turnaroundExcludedCount: number;
  reviewActivitySeries: Array<{
    bucketKey: string;
    label: string;
    approved: number;
    rejected: number;
    changesRequested: number;
    comments: number;
    reanalyzed: number;
  }>;
}

export interface AnalyticsTeamMemberItem {
  userId: number;
  name: string;
  role: string;
  jobTitle: string;
  submissionsCreated: number;
  reviewsCompleted: number;
  approvedCount: number;
  rejectedCount: number;
  changesRequestedCount: number;
  commentsCount: number;
  outstandingWorkload: number;
}

export interface TeamAnalyticsResponse {
  scope: 'organization';
  period: {
    range: AnalyticsRange;
    startDate: string | null;
    endDate: string | null;
  };
  summary: {
    activeContributors: number;
    activeReviewers: number;
    totalSubmissionsCreated: number;
    totalReviewsCompleted: number;
    pendingQueueSize: number;
  };
  members: AnalyticsTeamMemberItem[];
}

export interface GovernanceInsightItem {
  id: string;
  severity: 'info' | 'warning' | 'critical' | 'positive';
  title: string;
  observation: string;
  supportingData: string;
  impact: string;
  suggestedAction: string;
  targetPage?: 'guidelines' | 'analysis' | 'review' | 'corrections' | 'history' | 'submit';
  targetSubmissionId?: number | null;
  targetBrandId?: number | null;
}

export interface GovernanceAnalyticsResponse {
  scope: 'organization' | 'personal';
  canViewTeamAnalytics: boolean;
  timezone: 'UTC';
  appliedFilters: {
    range: AnalyticsRange;
    startDate: string | null;
    endDate: string | null;
    brandId: number | null;
    category: string | null;
    status: string | null;
    granularity: TrendGranularity;
  };
  brands: Array<{
    id: number;
    name: string;
    primaryColor: string;
    secondaryColor: string;
  }>;
  availableCategories: string[];
  overview: AnalyticsOverviewMetrics;
  trends: AnalyticsTrendPoint[];
  recurringViolations: AnalyticsRecurringViolationsPage;
  issueBreakdown: AnalyticsIssueBreakdown;
  reviewAnalytics: AnalyticsReviewMetrics;
  teamActivity: TeamAnalyticsResponse | null;
  insights: GovernanceInsightItem[];
  metricDefinitions: Array<{
    key: string;
    label: string;
    formula: string;
    dataSource: string;
  }>;
}

