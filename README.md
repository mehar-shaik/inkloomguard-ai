#Live Demo:
Link: https://inkloomguard-ai.onrender.com/

# InkloomGuard AI

**InkloomGuard AI** is a multi-tenant, AI-assisted brand compliance and governance platform built with TypeScript, Express, React, Vite, **Supabase PostgreSQL** (`pg`, with local `node:sqlite` dev fallback), **Supabase Private Storage**, and the Google Gemini API (`@google/genai`). It enables organizations to manage brand profiles, upload and extract structured brand compliance rules, audit copy, documents, and visual assets across eight compliance dimensions, iterate on revisions, and enforce role-based human approval workflows.

---

## Table of Contents

1. [Project Title — InkloomGuard AI](#inkloomguard-ai)
2. [Project Overview](#2-project-overview)
3. [Main Features](#3-main-features)
4. [Technology Stack](#4-technology-stack)
5. [Existing Project Architecture](#5-existing-project-architecture)
6. [Folder and File Structure](#6-folder-and-file-structure)
7. [Frontend Pages and Their Purpose](#7-frontend-pages-and-their-purpose)
8. [Backend Architecture](#8-backend-architecture)
9. [Database Schema and Relationships](#9-database-schema-and-relationships)
10. [Authentication and Bearer JWT Flow](#10-authentication-and-bearer-jwt-flow)
11. [Organization Isolation](#11-organization-isolation)
12. [Role-Based Access Control](#12-role-based-access-control)
13. [Brand Creation Workflow](#13-brand-creation-workflow)
14. [Company Logo Upload](#14-company-logo-upload)
15. [Brand Guideline Document Upload](#15-brand-guideline-document-upload)
16. [AI Brand Requirement Extraction](#16-ai-brand-requirement-extraction)
17. [Structured Brand Requirement Storage](#17-structured-brand-requirement-storage)
18. [Content Submission Workflow](#18-content-submission-workflow)
19. [Compliance Analysis Engine](#19-compliance-analysis-engine)
20. [Correction Suggestions](#20-correction-suggestions)
21. [Revision Management](#21-revision-management)
22. [Review and Approval Workflow](#22-review-and-approval-workflow)
23. [Review History](#23-review-history)
24. [API Endpoint Reference](#24-api-endpoint-reference)
25. [Environment Variables](#25-environment-variables)
26. [Local Development Setup](#26-local-development-setup)
27. [Installation Commands](#27-installation-commands)
28. [Database Setup and Migrations](#28-database-setup-and-migrations)
29. [How to Run the Application](#29-how-to-run-the-application)
30. [How to Build for Production](#30-how-to-build-for-production)
31. [Deployment Instructions](#31-deployment-instructions)
32. [Database Persistence and Backup](#32-database-persistence-and-backup)
33. [File Upload Storage](#33-file-upload-storage)
34. [Testing Instructions](#34-testing-instructions)
35. [Sample Test Organization and Brand](#35-sample-test-organization-and-brand)
36. [Troubleshooting](#36-troubleshooting)
37. [Security Considerations](#37-security-considerations)
38. [Known Limitations](#38-known-limitations)
39. [Production Readiness Checklist](#39-production-readiness-checklist)

---

## 2. Project Overview

InkloomGuard AI combines deterministic rule enforcement (exact terminology matching, SLA percentage checks, promotional superlative flags, WCAG readability/heading/alt-text checks, and `sharp` pixel-level color/luminance/logo-matching analysis) with Gemini LLM evaluation (`gemini-2.5-flash` by default, configurable via `GEMINI_MODEL`) strictly grounded in each brand's saved rules, visual identity settings, and approved company facts. Every organization operates inside an isolated tenant boundary with role-based governance (`reviewer` / `admin` vs `author`).

In production (Render Free), all application records persist in **Supabase PostgreSQL** (`DATABASE_URL`) and all uploaded brand logos, logo variants, avatars, guideline documents, and submission visual assets persist in your private **Supabase Storage** bucket (`inkloomguard-files`) with zero dependency on Render's ephemeral local filesystem. For local development without cloud credentials, the backend automatically falls back to local SQLite and `DATA_DIR/uploads/`.

## 3. Main Features

- **Multi-Tenant Organization Workspaces**: Isolated companies, brands, guideline documents, visual logo variants, submissions, issues, revisions, audit logs, and uploaded files.
- **Dual-Mode Persistent Database & Storage**: Production uses **Supabase PostgreSQL** (`DATABASE_URL`) and **Supabase Private Storage** (`inkloomguard-files`) with `stored_files` metadata tracking; local dev falls back cleanly to SQLite + `DATA_DIR/uploads/`.
- **Bearer JWT Auth, Email Verification & Active Session Control**: Stateless signed JWTs with `jti` identifiers tracked in `user_sessions` and `revoked_tokens`, Brevo HTTPS transactional email verification (`24h` SHA-256 hashed tokens) with an unverified-account workspace gate, and password reset (`30m` SHA-256 hashed tokens) with session invalidation.
- **Role-Based Access Control (RBAC)**: Separation between `reviewer` / `admin` (formal approvals, rejections, change requests, brand & guideline management, team member creation/role changes, organization settings, team analytics) and `author` (submissions, revisions, comments, personal analytics scope).
- **Guideline Parsing & Gemini Structured Extraction**: Extracts text from PDF, DOCX, TXT, and Markdown files in memory, detects rule conflicts, and requires explicit reviewer confirmation before writing `brand_rules`, `brand_visual_guidelines`, `approved_facts`, and `terminology_rules`.
- **Eight-Area Hybrid Compliance & Visual Brand Detection Engine**: Audits `Brand Tone`, `Terminology`, `Brand Messaging`, `Facts`, `Promotional Claims`, `Visual Identity` (`sharp` perceptual color/deltaE, logo distortion/aspect-ratio/clear-space/variant checks + Gemini Vision), `Accessibility`, and `Governance`, marking unrun checks explicitly as `not_performed`.
- **Governance Analytics Dashboard**: Live UTC analytics across Compliance Overview, Trends, Recurring Violations with period-over-period delta, Text vs. Visual Identity Breakdown, Review Turnaround Performance, RBAC-scoped Team Activity, and grounded Actionable Insights.
- **Profile Picture Editor & Claymorphic Settings**: Interactive circular crop/zoom/pan avatar editor (`5 MB` limit, rasterized via `sharp`), editable profile details, persisted theme/notification/landing preferences (`preferences_json`), and active session revocation.

## 4. Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Lucide React icons (`lucide-react`), Motion (`motion`).
- **Backend**: Node.js `v22+`, Express 4 (`express`), Multer (`multer` memory storage), JSON Web Tokens (`jsonwebtoken`), bcryptjs (`bcryptjs`).
- **Database**: **Supabase PostgreSQL** (`pg` pool via `DATABASE_URL`) in production; Node built-in SQLite (`node:sqlite` `DatabaseSync`) in local development when `DATABASE_URL` is unset.
- **File Storage**: **Supabase Private Storage** (`@supabase/supabase-js` bucket `inkloomguard-files`) in production; local `DATA_DIR/uploads/` in local development only.
- **Document & Image Processing**: `pdf-parse` v2 (`PDFParse` for PDF), `mammoth` (DOCX), `sharp` (in-memory raster decoding, EXIF stripping, pixel color/luminance/WCAG contrast, clear-space, and logo template matching).
- **AI & Email Integration**: `@google/genai` SDK calling `gemini-2.5-flash` (or `GEMINI_MODEL`) server-side via `GEMINI_API_KEY`; Brevo Transactional Email HTTPS API (`https://api.brevo.com/v3/smtp/email`).
- **CI/CD & Hosting**: GitHub + GitHub Actions (`.github/workflows/ci.yml`), Render Free (`render.yaml`), Supabase Free.

## 5. Existing Project Architecture

InkloomGuard AI runs as a **single-server stateless full-stack Node.js application** listening on `process.env.PORT` (defaulting to `3000` locally):

- `server.ts` validates production storage/database requirements, initializes migrations (`initDatabase()`), configures security and CORS headers (`CORS_ORIGINS`, `APP_URL`, `RENDER_EXTERNAL_URL`), mounts `/api/*` Express routes via `createApiRouter()`, handles graceful `SIGTERM`/`SIGINT` shutdown, and serves Vite middleware in dev (`NODE_ENV !== 'production'`) or compiled `dist/` SPA in production (`NODE_ENV === 'production'`).
- In development (`npm run dev`), `tsx server.ts` runs Express + Vite middleware on `http://localhost:3000`.
- In production (`npm run build && NODE_ENV=production npm start`), `node server.ts` executes natively using Node 22 TypeScript type-stripping and serves `dist/index.html` alongside `/api/*`.

## 6. Folder and File Structure

```text
.
├── .env.example                       # Server-side environment variable template (no secrets)
├── .github/workflows/ci.yml           # GitHub Actions CI (lint, build, test) & optional Render hook
├── .gitignore                         # Excludes node_modules, dist, data/, .env*
├── index.html                         # SPA HTML shell & metadata
├── metadata.json                      # Applet name, description, capabilities
├── package.json                       # Dependencies, build, start, test, and migration scripts
├── render.yaml                        # Render Free Web Service blueprint
├── tsconfig.json                      # TypeScript compiler configuration (noEmit)
├── vite.config.ts                     # Vite + React + Tailwind v4 configuration
├── server.ts                          # Unified Express + Vite/static entry point (uses PORT)
├── server/
│   ├── auth.ts                        # Async JWT signing/verification, revocation, RBAC middleware
│   ├── complianceEngine.ts            # 8-area deterministic + Gemini compliance engine
│   ├── db.ts                          # Async PostgreSQL (DATABASE_URL) & local SQLite dual-engine adapter
│   ├── email.ts                       # Brevo Transactional Email HTTPS API client (https://api.brevo.com/v3/smtp/email)
│   ├── env.ts                         # Conditional dotenv loader (loads .env locally; skipped during npm test)
│   ├── governanceAnalytics.ts         # Governance analytics aggregation, turnaround math, rule normalization & caching
│   ├── parsers.ts                     # In-memory magic-byte/SVG validation, PDF/DOCX/TXT/Image parsers
│   ├── routes.ts                      # All REST API endpoints (/api/*)
│   ├── storage.ts                     # Supabase Storage (inkloomguard-files) & local fallback abstraction
│   └── visualDetection.ts             # Hybrid deterministic + Vision AI visual brand detection engine
├── supabase/migrations/
│   ├── 0001_initial_schema.sql        # Idempotent PostgreSQL core tables & indexes
│   ├── 0010_governance_analytics.sql  # Idempotent analysis_runs audit log & analytics indexes
│   └── 0011_allow_admin_role.sql      # Safe users.role CHECK constraint update allowing reviewer, author, and admin
├── scripts/
│   ├── migrate-postgres.ts            # Safe CLI runner applying supabase/migrations/*.sql
│   └── migrate-sqlite-to-postgres.ts  # Non-destructive SQLite -> Supabase Postgres & Storage migrator
├── tests/
│   └── integration.test.ts            # Automated API, RBAC, analytics, visual detection & tenant-isolation suite
└── src/
    ├── App.tsx                        # Root shell, session gate, navigation, Quick Search (⌘K)
    ├── api.ts                         # Typed fetch wrapper, Bearer storage, response validation
    ├── index.css                      # Tailwind v4 + Claymorphic Light & Dark design tokens
    ├── main.tsx                       # React root mount
    ├── types.ts                       # Shared TypeScript interfaces
    ├── assets/images/                 # Static UI emblem & avatar assets
    ├── components/
    │   ├── AnalyticsCharts.tsx        # Accessible interactive SVG trend, review activity & breakdown charts
    │   └── ClayUI.tsx                 # StatusBadge, SeverityBadge, ThemeToggle, ProtectedImage
    └── pages/                         # Auth, Dashboard, Analytics, Guidelines, Submit, Analysis, Corrections, Review, History, Settings, Profile
```

## 7. Frontend Pages and Their Purpose

1. **`AuthPage` (`src/pages/AuthPage.tsx`)**: Handles Sign In, new organization registration (`reviewer` or `author`), and one-click login to the seeded `AetherFlow Systems` workspace (`POST /api/auth/demo`).
2. **`DashboardPage` (`src/pages/DashboardPage.tsx`)**: Displays 4 organization KPI cards (`Total Submissions`, `Open Issues Found`, `Pending Reviews`, `Approved Content`), brand profiles with create/edit modals (and `reviewer`-only delete), and the `Recent Activity` timeline.
3. **`GuidelinesPage` (`src/pages/GuidelinesPage.tsx`)**: Manages brand guideline document uploads (`.pdf`, `.docx`, `.txt`, `.md`), on-demand Gemini extraction, Brand Tone & Messaging Pillars, Approved Company Facts, and Prohibited/Preferred Terminology rules.
4. **`SubmitPage` (`src/pages/SubmitPage.tsx`)**: Lets authors/reviewers select a brand, enter a title, paste copy, and attach optional documents or images (with alt text) to run the 8-area audit.
5. **`AnalysisPage` (`src/pages/AnalysisPage.tsx`)**: Renders the 8-area status grid (`passed`, `issues_found`, `warning`, `not_performed`), Jimp visual pixel/color/contrast telemetry, and each finding's severity, original text, explanation, verbatim evidence, and suggested correction.
6. **`CorrectionsPage` (`src/pages/CorrectionsPage.tsx`)**: Side-by-side comparison of read-only original content vs editable revised copy, one-click Accept/Reject per issue, and revision saving (`POST /api/submissions/:id/revisions`).
7. **`ReviewPage` (`src/pages/ReviewPage.tsx`)**: Governance sign-off workspace showing the latest draft, visual asset, audit trail, and role-gated actions (`Approve Content`, `Request Changes`, `Reject Content` for `reviewer` only; `Post Comment` for both `author` and `reviewer`).
8. **`HistoryPage` (`src/pages/HistoryPage.tsx`)**: Searchable and status-filterable table of all organization submissions with an Inspection modal showing original vs revised text, findings, saved revisions, and review events.

## 8. Backend Architecture

- **Framework**: Express 4 router mounted at `/api` (`server/routes.ts`).
- **Entry & Middleware (`server.ts`)**: `trust proxy` enabled (`1`), security headers (`X-Content-Type-Options`, `Referrer-Policy`, `X-DNS-Prefetch-Control`, conditional `HSTS`), origin-validated CORS (`localhost`, `127.0.0.1`, `*.run.app`, `*.onrender.com`, `aistudio.google.com`, `APP_URL`, `RENDER_EXTERNAL_URL`, `CORS_ORIGINS`), JSON/URL-encoded body parsing (`5 MB`), Multer memory storage (`10 MB` max file size), and safe JSON error handling without stack trace exposure.
- **Database Initialization (`server/db.ts`)**: Uses `pg.Pool` (`DATABASE_URL`) in production to apply `supabase/migrations/*.sql` idempotently (tracked in `schema_migrations`), prunes expired entries from `revoked_tokens`, and seeds `AetherFlow Systems` only if `companies` is empty. Falls back to local `node:sqlite` only in local development when `DATABASE_URL` is unset.

## 9. Database Schema and Relationships

All tenant tables reference `companies(id)` with `ON DELETE CASCADE` (including `stored_files` for Supabase Storage / local asset tracking):

- **`companies`**: `id`, `name`, `created_at`.
- **`users`**: `id`, `company_id -> companies.id`, `name`, `email (UNIQUE)`, `password_hash`, `role` (`'reviewer' | 'author' | 'admin'`), `created_at`.
- **`brands`**: `id`, `company_id -> companies.id`, `name`, `industry`, `primary_color`, `secondary_color`, `logo_filename`, `logo_original_name`, `created_at`.
- **`guideline_documents`**: `id`, `company_id`, `brand_id -> brands.id`, `filename`, `original_name`, `file_type`, `extracted_text`, `uploaded_by`, `created_at`.
- **`brand_rules`**: `id`, `company_id`, `brand_id -> brands.id (UNIQUE)`, `tone_rules`, `messaging_rules`, `updated_at`.
- **`approved_facts`**: `id`, `company_id`, `brand_id -> brands.id`, `fact_key`, `fact_value`, `source_doc`, `created_at`.
- **`terminology_rules`**: `id`, `company_id`, `brand_id -> brands.id`, `prohibited_term`, `preferred_term`, `severity`, `notes`, `created_at`.
- **`submissions`**: `id`, `company_id`, `brand_id -> brands.id`, `submitted_by -> users.id`, `title`, `input_type`, `original_content`, `revised_content`, `file_filename`, `file_original_name`, `image_filename`, `image_alt_text`, `status`, `checks_summary_json`, `image_metrics_json`, `created_at`, `updated_at`.
- **`compliance_issues`**: `id`, `company_id`, `submission_id -> submissions.id`, `category`, `severity`, `original_text`, `explanation`, `evidence`, `suggested_correction`, `resolution_status`, `created_at`.
- **`revisions`**: `id`, `company_id`, `submission_id -> submissions.id`, `edited_by`, `content`, `note`, `created_at`.
- **`review_events`**: `id`, `company_id`, `submission_id -> submissions.id`, `reviewer_id`, `reviewer_name`, `decision`, `comment`, `created_at`.
- **`revoked_tokens`**: `jti (PRIMARY KEY)`, `expires_at`, `created_at`.

## 10. Authentication and Bearer JWT Flow

InkloomGuard AI uses **`Authorization: Bearer <token>`** instead of third-party cookies so authentication works reliably both directly and inside cross-origin iframes (e.g. Google AI Studio preview):

1. User signs in (`/api/auth/login`), registers (`/api/auth/register`), or uses demo login (`/api/auth/demo`).
2. `server/auth.ts` verifies credentials with `bcryptjs` (`cost = 10`) and signs a 7-day JWT (`issuer: 'inkloomguard-ai'`, unique `jti: crypto.randomUUID()`) using `JWT_SECRET` (required in production; local dev only falls back to `${DATA_DIR}/.jwt_secret`).
3. Frontend stores the token under `inkloom_auth_token` in `localStorage`/`sessionStorage` (`src/api.ts`) and verifies the session via `GET /api/auth/me` before rendering protected pages (`src/App.tsx`).
4. Every protected API request includes `Authorization: Bearer <token>`. `requireAuth` verifies signature/issuer/expiry, confirms `jti` is not in `revoked_tokens`, and loads the user + organization from PostgreSQL (or SQLite in local dev).
5. `POST /api/auth/logout` extracts the Bearer token and inserts its `jti` into `revoked_tokens`, rejecting future use of that token with `401` while leaving other users' sessions active.

## 11. Organization Isolation

Every query and mutation in `server/routes.ts` filters explicitly by `req.user!.companyId`:

- Brands, guidelines, facts, terminology, submissions, compliance issues, revisions, review events, and team member lists all require matching `company_id`.
- Cross-tenant resource access returns `404` on scoped endpoints or `403` on `/api/uploads/:filename`.
- Uploaded logos, documents, and submission images are not exposed via a public static folder; they are served exclusively through `GET /api/uploads/:filename` with `requireAuth` and tenant ownership verification.

## 12. Role-Based Access Control

Workspace roles (`reviewer` / `admin` and `author`):

- **`reviewer` / `admin`**: Full read/write access across brands, guidelines, visual guidelines, logo variants, submissions, revisions, comments, formal review decisions (`approved`, `rejected`, `changes_requested`), brand/document/fact/terminology deletion, organization renaming, team member creation/role updates, and organization-wide Governance Analytics (`GET /api/analytics/team`).
- **`author`**: Can view organization brands/guidelines/history, submit content, resolve issue suggestions, save revisions, post governance comments (`decision: 'comment'`), and view personal Governance Analytics (`scope=personal`). Blocked with `403 Forbidden` on brand/guideline mutations, formal review decisions, organization renaming, team management, and org-wide analytics (`requireRole('reviewer', 'admin')`).

## 13. Brand Creation Workflow

From **Dashboard → Add Brand** (or `POST /api/brands`), reviewers/admins provide `name`, `industry`, validated `#RRGGBB` `primaryColor` (default `#4F46E5`) and `secondaryColor` (default `#06B6D4`), and an optional logo file. Creating a brand also initializes its `brand_rules` row (`tone_rules: ''`, `messaging_rules: ''`).

## 14. Company Logo Upload

- Allowed extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg` (up to `10 MB`).
- Validated both by extension, file content/magic bytes (`validateUploadedBufferContent`), and `sharp` raster decode bounds (`validateRasterImageBuffer`), rejecting SVG files containing `<script>`, `<!ENTITY`, `<iframe>`, `<object>`, `<embed>`, `javascript:`, `vbscript:`, `data:text/html`, `<foreignObject>`, or inline `on*=` attributes.
- Rendered in the UI via `<ProtectedImage />` using `fetchProtectedAssetBlobUrl()` with Bearer authentication.

## 15. Brand Guideline Document Upload

On **Brand Guidelines**, uploading a `.pdf`, `.docx`, `.txt`, or `.md` file (`POST /api/guidelines/:brandId/upload`) validates magic bytes/UTF-8 text, extracts raw text via `pdf-parse` (`PDFParse`), `mammoth`, or UTF-8 decode, and saves the document record in `guideline_documents`.

## 16. AI Brand Requirement Extraction

When `autoExtract=true` on upload or when clicking **Extract Rules** (`POST /api/guidelines/:brandId/ai-extract/:docId`), `extractStructuredGuidelinesFromText()` sends up to 24,000 characters of the document to `getGeminiModel()` (`gemini-2.5-flash` by default) with exponential-backoff retries (`generateContentWithRetry`, up to 3 attempts on transient `503`/`429` errors) and a strict JSON schema (`toneRules`, `messagingRules`, `facts`, `terminology`, `visualGuidelines`). If `GEMINI_API_KEY` is missing or Gemini fails, `formatGeminiError()` returns a clear human-readable `503`/`429`/`504`/`500` error rather than fabricating rules. Extracted rules stay in proposal review until explicitly confirmed via `POST /api/guidelines/:brandId/apply-extracted`.

## 17. Structured Brand Requirement Storage

Extracted (or manually entered) requirements are persisted across four tenant-scoped tables:

- `brand_rules`: Voice/tone rules and messaging pillars (`PUT /api/guidelines/:brandId/rules`).
- `brand_visual_guidelines` & `brand_logo_variants`: Accent colors, approved backgrounds, logo min-width/clear-space/placement/misuse rules, typography rules, and logo variants (`PUT /api/guidelines/:brandId/visual`, `POST /api/guidelines/:brandId/logo-variants`).
- `approved_facts`: Key-value facts with document/page/section provenance (`POST /api/guidelines/:brandId/facts`).
- `terminology_rules`: Prohibited term, preferred replacement, severity (`critical | high | medium | low`), and notes (`POST /api/guidelines/:brandId/terminology`).

## 18. Content Submission Workflow

On **Submit Content**, users select a brand, provide a title, and supply pasted copy, a `.pdf`/`.docx`/`.txt`/`.md` document, and/or an image (`.png`, `.jpg`, `.jpeg`, `.webp`) with optional alt text (`POST /api/submissions`, supporting `Idempotency-Key` deduplication). Original pasted/extracted text is preserved permanently in `submissions.original_content`.

## 19. Compliance Analysis Engine

`runFullComplianceAnalysis()` (`server/complianceEngine.ts`) evaluates eight areas:

1. **Brand Tone** (Gemini grounded in `brand_rules.tone_rules`; `not_performed` if empty or AI unavailable).
2. **Terminology** (Deterministic word-boundary regex matching against `terminology_rules`, case-sensitive when casing differs).
3. **Brand Messaging** (Gemini grounded in `brand_rules.messaging_rules`; `not_performed` if empty or AI unavailable).
4. **Facts** (Deterministic SLA/percentage contradiction checks + Gemini comparison against `approved_facts`).
5. **Promotional Claims** (Deterministic regex for unsubstantiated superlatives/guarantees + Gemini claim detection).
6. **Visual Identity** (`sharp` perceptual CIELAB color comparison against primary/secondary/accent/background palettes, logo template/aspect-ratio/clear-space/placement matching across primary logo & `brand_logo_variants` + Gemini Vision evaluation when configured).
7. **Accessibility** (Deterministic alt-text presence/quality, WCAG luminance contrast spread `>= 3.0:1`, heading hierarchy jump checks, and >45-word sentence readability checks).
8. **Governance** (Tracks pending review state and updates on human reviewer decisions).

## 20. Correction Suggestions

On **Correction Suggestions**, each finding from `compliance_issues` can be marked `accepted`, `rejected`, or `open` via `POST /api/submissions/:id/issues/:issueId/resolve`. Accepting a suggestion replaces matching `original_text` inside the working draft editor without altering `original_content`.

## 21. Revision Management

Saving in **Correction Suggestions** calls `POST /api/submissions/:id/revisions`, which inserts an immutable snapshot in `revisions`, updates `submissions.revised_content`, transitions status to `pending_review`, and logs a `revision_saved` entry in `review_events`.

## 22. Review and Approval Workflow

On **Review & Approval**, `POST /api/submissions/:id/review` accepts `approved`, `rejected`, `changes_requested` (`reviewer` role only), or `comment` (`author` or `reviewer`). Formal decisions update `submissions.status` and the `Governance` summary inside `checks_summary_json`, and append an immutable record to `review_events`.

## 23. Review History

**Review History** loads all organization submissions with search by title/brand, status filter tabs (`All`, `Pending Review`, `Approved`, `Changes Requested`, `Rejected`), and an inspection modal displaying original vs revised copy, issues/evidence, revisions, and review events.

### 23a. Governance Analytics Dashboard (`src/pages/AnalyticsPage.tsx` & `server/governanceAnalytics.ts`)

The **Governance Analytics** workspace aggregates persisted audit data into six sections with zero fabricated metrics:

1. **Compliance Overview**: Tracks distinct `totalSubmissions`, `analyzedSubmissions` (`compliance_score IS NOT NULL AND ai_status != 'pending'`), `fullyCompliantSubmissions` (no open violations and not `rejected`/`changes_requested`), `submissionsRequiringCorrections`, `awaitingReviewCount`, `approvedCount`, `rejectedCount`, `openViolationsCount`, and `complianceRate` (`null` when 0 analyzed). Re-analysis runs are logged in `analysis_runs` and counted separately (`reanalysisRunsCount`) so distinct submission totals are never double-counted.
2. **Compliance Trends**: Continuous UTC daily (`7d`/`30d`), weekly (`90d`), or monthly (`12m`/`all`) time-series charts for compliance rate %, submission volume vs violations, and approved/changes-requested/rejected outcomes.
3. **Recurring Violations**: Normalizes text and `Visual Identity` rules (`ruleKey`), returning paginated occurrence counts, distinct `affectedSubmissions`, severity distributions, and equal-length previous-period deltas (`GET /api/analytics/recurring-violations`).
4. **Text vs. Visual Identity Breakdown**: Compares textual vs visual violation volume and breaks down stored Visual Brand Detection checks (`Logo Matching`, `Logo Distortion`, `Logo Clear Space & Placement`, `Brand Colors`, `Typography`) directly from persisted `visual_analysis_json` and `compliance_issues`.
5. **Review & Approval Performance**: Computes `averageTurnaroundHours` and `medianTurnaroundHours` from valid `(submission.created_at -> earliest formal review_events.created_at)` pairs (safely excluding missing/negative deltas via `turnaroundExcludedCount`), approval/rejection/changes-requested rates, and review activity timelines.
6. **Team Review Activity (RBAC-Gated) & Actionable Insights**: `reviewer`/`admin` users receive organization-wide metrics and non-PII team activity (`GET /api/analytics/team`); `author` users receive `403` on `/api/analytics/team` and `?scope=organization`, and `/api/analytics/governance` scopes Author metrics strictly to their own `submitted_by` submissions with `teamActivity: null`. Grounded insights link directly to `guidelines`, `analysis`, `corrections`, `review`, or `history`.
- **Timezone Handling**: Date range filters (`7d`, `30d`, `90d`, `12m`, `custom`, `all`) and timeline buckets are evaluated in **UTC** on the backend so `YYYY-MM-DD` custom windows remain consistent across PostgreSQL and SQLite.

## 24. API Endpoint Reference

| Method | Endpoint | Auth | Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | Any | Health check (`status`, `database`, `engine`, `storage`, `emailConfigured`, `geminiConfigured`, `demoAvailable`, `demoStatus`) |
| `POST` | `/api/auth/register` | Public | Any | Create organization + initial user; sends verification email; returns `{ user, token }` |
| `POST` | `/api/auth/login` | Public | Any | Authenticate email/password & create tracked session; returns `{ user, token }` |
| `POST` | `/api/auth/demo` | Public (opt-in in prod) | Any | Sign in to pre-seeded `AetherFlow Systems` workspace (`404` in production unless `ENABLE_DEMO_LOGIN=true`; `503` if demo account is unprovisioned) |
| `POST` | `/api/auth/logout` | Optional Bearer | Any | Revoke current JWT `jti` in `revoked_tokens` and `user_sessions` |
| `POST` | `/api/auth/logout-all` | Bearer | Any | Increment `token_version` and revoke all active sessions for caller |
| `GET` | `/api/auth/me` | Bearer | Any | Verify token and return `{ user }` |
| `GET` | `/api/auth/sessions` | Bearer | Any | List active tracked sessions for caller |
| `POST` | `/api/auth/sessions/revoke-others` | Bearer | Any | Rotate current token & revoke all other device sessions |
| `DELETE` | `/api/auth/sessions/:sessionId` | Bearer | Any | Revoke a single non-current active session |
| `POST` | `/api/auth/forgot-password` | Public | Any | Issue `30m` SHA-256 reset token & email via Brevo HTTPS (neutral 200) |
| `GET` | `/api/auth/reset-password/validate` | Public | Any | Validate reset token status without consuming it |
| `POST` | `/api/auth/reset-password` | Public | Any | Consume reset token, update password, rotate sessions & email alert |
| `POST` | `/api/auth/verify-email` | Public | Any | Consume `24h` SHA-256 verification token and verify user email |
| `POST` | `/api/auth/resend-verification` | Optional Bearer | Any | Resend verification email (rate-limited 3 / 15 min) |
| `POST` | `/api/auth/change-password` | Bearer (Verified) | Any | Change password, rotate current token, revoke others & email alert |
| `GET` / `PUT` | `/api/preferences` | Bearer | Any | Read or merge validated theme, notification & default page preferences |
| `GET` / `PUT` | `/api/organization` | Bearer (Verified) | Any / `reviewer` or `admin` | Read org overview (`GET`) or rename organization (`PUT`) |
| `PUT` | `/api/profile` | Bearer | Any | Update caller display name, job title, and bio |
| `POST` / `DELETE` | `/api/profile/avatar` | Bearer | Any | Upload/replace (`5 MB`, `sharp` re-encoded) or remove profile picture |
| `GET` | `/api/team/members` | Bearer (Verified) | Any | List non-sensitive teammate profiles in caller's organization |
| `POST` | `/api/team/members` | Bearer (Verified) | `reviewer` / `admin` | Create `author` / `reviewer` (or `admin` by `admin` only) teammate in caller's org |
| `PATCH` | `/api/team/members/:memberId/role` | Bearer (Verified) | `reviewer` / `admin` | Update teammate role (`author` / `reviewer`, or `admin` by `admin` only; non-self, last-reviewer/admin protected) |
| `GET` | `/api/uploads/id/:fileId` & `/signed-url` | Bearer (Verified or own avatar) | Any | Stream or sign tenant-owned asset by `stored_files.id` |
| `GET` | `/api/uploads/:filename` & `/signed-url` | Bearer (Verified or own avatar) | Any | Stream or sign tenant-owned asset by sanitized filename |
| `GET` | `/api/dashboard` | Bearer (Verified) | Any | Return KPI metrics, org brands, and 12 recent review events |
| `GET` | `/api/analytics/governance` | Bearer (Verified) | Any (`reviewer` org / `author` self) | Filtered governance KPIs, trends, recurring violations, visual/text breakdowns, turnaround & insights |
| `GET` | `/api/analytics/recurring-violations` | Bearer (Verified) | Any (`reviewer` org / `author` self) | Paginated normalized recurring violations with period-over-period delta |
| `GET` | `/api/analytics/team` | Bearer (Verified) | `reviewer` / `admin` | Non-PII org team submission, review decision, and workload metrics (`403` for `author`) |
| `GET` | `/api/brands` | Bearer (Verified) | Any | List organization brands |
| `POST` | `/api/brands` | Bearer (Verified) | `reviewer` / `admin` | Create brand with validated hex palette & optional logo (`multipart/form-data`) |
| `PUT` | `/api/brands/:id` | Bearer (Verified) | `reviewer` / `admin` | Update brand profile, palette, or logo |
| `DELETE` | `/api/brands/:id` | Bearer (Verified) | `reviewer` / `admin` | Delete brand, cascading rows, and backing storage objects |
| `GET` | `/api/guidelines/:brandId` | Bearer (Verified) | Any | Fetch brand docs, facts, terminology, rules, visual rules & logo variants |
| `PUT` | `/api/guidelines/:brandId/visual` | Bearer (Verified) | `reviewer` / `admin` | Update visual brand guidelines (colors, backgrounds, logo & typography rules) |
| `POST` / `DELETE` | `/api/guidelines/:brandId/logo-variants` (`/:variantId`) | Bearer (Verified) | `reviewer` / `admin` | Upload or delete approved logo variant with computed visual profile |
| `POST` | `/api/guidelines/:brandId/upload` | Bearer (Verified) | `reviewer` / `admin` | Upload PDF/DOCX/TXT/MD guideline; optional `autoExtract` proposal |
| `POST` | `/api/guidelines/:brandId/ai-extract/:docId` | Bearer (Verified) | `reviewer` / `admin` | Run Gemini structured extraction on an uploaded guideline document |
| `DELETE` | `/api/guidelines/:brandId/documents/:docId` | Bearer (Verified) | `reviewer` / `admin` | Delete guideline document & backing storage asset |
| `POST` | `/api/guidelines/:brandId/apply-extracted` | Bearer (Verified) | `reviewer` / `admin` | Confirm & apply extracted rules with verified document provenance |
| `PUT` | `/api/guidelines/:brandId/rules` | Bearer (Verified) | `reviewer` / `admin` | Save `tone_rules` and `messaging_rules` |
| `POST` / `DELETE` | `/api/guidelines/:brandId/facts` (`/:factId`) | Bearer (Verified) | `reviewer` / `admin` | Add or delete approved company fact |
| `POST` / `DELETE` | `/api/guidelines/:brandId/terminology` (`/:ruleId`) | Bearer (Verified) | `reviewer` / `admin` | Add or delete prohibited/preferred terminology rule |
| `GET` | `/api/submissions` | Bearer (Verified) | Any | List org submissions with issue counts & latest decision |
| `GET` | `/api/submissions/:id` | Bearer (Verified) | Any | Fetch submission, issues, revisions, review events & logo variants |
| `POST` | `/api/submissions` | Bearer (Verified) | Any | Submit text/doc/image with `Idempotency-Key` & run 8-area compliance scan |
| `POST` | `/api/submissions/:id/reanalyze` | Bearer (Verified) | Any | Acquire DB reanalysis lock & re-run full text + visual compliance scan |
| `POST` | `/api/submissions/:id/issues/:issueId/resolve` | Bearer (Verified) | Any | Mark issue `accepted`, `rejected`, or `open` |
| `POST` | `/api/submissions/:id/revisions` | Bearer (Verified) | Any | Save revised draft without overwriting original copy |
| `POST` | `/api/submissions/:id/review` | Bearer (Verified) | `reviewer` / `admin` (decisions) / Any (`comment`) | Record approval, rejection, change request, or comment |

## 25. Environment Variables

All environment variables are **backend-only**. Never prefix database URLs, Supabase secret keys, or API keys with `VITE_`.

| Variable | Required in Production | Purpose |
| :--- | :--- | :--- |
| `DATABASE_URL` | **Yes** | Supabase PostgreSQL connection string (Pooler URI). Required when `NODE_ENV=production`. |
| `SUPABASE_URL` | **Yes** | Supabase project URL (`https://<ref>.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase server-side secret key (`sb_secret_...` or legacy `service_role` JWT). Used strictly on the backend to access private bucket `inkloomguard-files`. |
| `SUPABASE_STORAGE_BUCKET` | **Yes** | Private Supabase Storage bucket name: `inkloomguard-files`. |
| `JWT_SECRET` | **Yes** | Random secret (`>= 32` chars) used to sign/verify Bearer JWTs across restarts. |
| `GEMINI_API_KEY` | **Yes** (for AI checks) | Google Gemini API key used server-side for guideline extraction, compliance analysis, and Vision checks. |
| `GEMINI_MODEL` | Optional (`gemini-2.5-flash`) | Override the default Gemini model alias used server-side. |
| `GEMINI_TIMEOUT_MS` | Optional (`120000`) | Positive integer timeout in milliseconds for server-side Gemini API operations (defaults to `120000`). |
| `BREVO_API_KEY` | **Yes** (for transactional email) | Server-side Brevo Transactional Email HTTPS API key (`POST https://api.brevo.com/v3/smtp/email`). Never expose to frontend. |
| `BREVO_SENDER_EMAIL` | **Yes** (for transactional email) | Verified Brevo sender email address used for verification, password-reset, and password-changed emails. |
| `BREVO_SENDER_NAME` | Optional (`InkloomGuard AI`) | Display sender name used in Brevo transactional emails (defaults to `InkloomGuard AI`). |
| `APP_BASE_URL` | **Yes** | Public application origin used to build email verification and password-reset links (`http://localhost:3000` locally; `https://<your-render-service>.onrender.com` on Render). |
| `NODE_ENV` | **Yes** (`production`) | `development` locally; `production` on Render (serves pre-built `dist/` SPA and enforces persistent Postgres + Supabase Storage). |
| `PORT` | Injected by Render | HTTP bind port (`process.env.PORT`, defaults to `3000` locally). |
| `CORS_ORIGINS` | Recommended after deploy | Comma-separated production origins (e.g. `https://inkloomguard-ai.onrender.com`). `APP_URL` and `RENDER_EXTERNAL_URL` are also accepted. |
| `DATA_DIR` | Local Dev Only | Directory for local SQLite + local upload fallback when Supabase env vars are unset. Never used in production. |

## 26. Local Development Setup

Prerequisites:
- Node.js `v22.18+` (tested on `v22.23.2`)
- `bun` (`v1.4+`) or `npm`

Copy `.env.example` to `.env` (never commit `.env`):

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

### Local Configuration Notes
- **Local Database & Storage (Zero Cloud Setup Required)**: `.env.example` keeps `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `JWT_SECRET` commented out so local runs automatically use SQLite (`./data/inkloomguard.db` with `email_verification_tokens` and `password_reset_tokens` created on boot), local `./data/uploads/`, and an auto-generated `./data/.jwt_secret`.
- **Local Verification Links**: Keep `APP_BASE_URL="http://localhost:3000"` and `APP_URL="http://localhost:3000"` in your local `.env` so verification and password-reset emails link to `http://localhost:3000/?mode=verify-email&token=...`. On Render, keep `APP_BASE_URL` set to `https://<your-render-service>.onrender.com` in the Render dashboard.
- **Real Brevo HTTPS Email Delivery Locally**: Set `BREVO_API_KEY`, a verified `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME` in `.env` (server-side only — never prefix with `VITE_`). Leave `NODE_ENV="development"`.

## 27. Installation Commands

```powershell
# Windows PowerShell
npm install --include=dev --legacy-peer-deps
```

```bash
# macOS / Linux (or with bun)
bun install --frozen-lockfile
# or with npm:
npm install --include=dev --legacy-peer-deps
```

## 28. Database Setup and Migrations

### Safe Automatic & CLI PostgreSQL Migrations
Additive, idempotent SQL migrations live in `supabase/migrations/` (`0001` through `0011`):
- `0001_initial_schema.sql` — core 12 tenant tables and indexes using `IF NOT EXISTS`
- `0002_storage_metadata.sql` — `stored_files` asset tracking table
- `0003_performance_and_caching.sql` & `0003_round3_profile_analytics.sql` — extraction/content hash caching, idempotency keys, profile columns, and analytics indexes
- `0004_auth_security_tokens.sql`, `0005_security_and_index_cleanup.sql` & `0006_comprehensive_integrity.sql` — `password_reset_tokens`, `email_verification_tokens`, composite foreign keys, and provenance columns
- `0007_user_avatar_storage.sql` & `0008_user_sessions_and_settings.sql` — `user_avatar` storage rules, `user_sessions`, and `preferences_json`
- `0009_visual_brand_detection.sql` & `0010_governance_analytics.sql` — `brand_visual_guidelines`, `brand_logo_variants`, `analysis_runs`, and analytics indexes
- `0011_allow_admin_role.sql` — safely replaces the `users.role` CHECK constraint to permit `reviewer`, `author`, and `admin` without altering existing user rows

Apply migrations explicitly against Supabase PostgreSQL before or during deployment (never drops or resets existing tables):

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

`initDatabase()` also checks `schema_migrations` on server boot and applies any pending `supabase/migrations/*.sql` files inside a transaction automatically.

### Migrating Existing Local SQLite Data to Supabase (Non-Destructive)
If you already have brands, guidelines, submissions, or uploads in a local SQLite database (`./data/inkloomguard.db`), migrate them safely without overwriting existing PostgreSQL rows:

```bash
DATABASE_URL="postgresql://..." \
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SECRET_KEY" \
SUPABASE_STORAGE_BUCKET="inkloomguard-files" \
npm run db:migrate:sqlite
```

This script copies rows with `ON CONFLICT DO NOTHING`, resets PostgreSQL `IDENTITY` sequences above `MAX(id)`, and uploads local files into private bucket `inkloomguard-files` with matching `stored_files` rows.

## 29. How to Run the Application

InkloomGuard AI serves both the **Express `/api/*` backend** and the **React + Vite frontend** from a single server on `http://localhost:3000`.

**Development mode (Windows PowerShell / macOS / Linux)**:

```powershell
npm run dev
```

On startup, confirm the server logs show:
- `db=sqlite` (or `db=postgres` if testing with `DATABASE_URL`)
- `[InkloomGuard AI] Email delivery ready: provider=brevo-https, endpoint=https://api.brevo.com/v3/smtp/email, appBaseUrl=http://localhost:3000`

Verify health and Brevo readiness from PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Confirm `"status": "ok"`, `"database": "connected"`, and `"emailConfigured": true`.

**Production simulation locally (Windows PowerShell)**:

```powershell
npm run build
$env:NODE_ENV="production"; npm start
```

> **Note:** Production mode (`NODE_ENV="production"`) requires `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `JWT_SECRET`. For normal local email verification testing, use `npm run dev` with `NODE_ENV="development"`.

## 30. How to Build for Production

```bash
npm run lint
npm run build
```

## 31. Deployment Instructions (Supabase Free + GitHub + GitHub Actions + Render Free)

### Step 1: Create the Supabase Project
1. Sign in to [Supabase](https://supabase.com) and click **New project** on the Free tier.
2. Choose a region close to your Render region (e.g., US West / Oregon) and save a strong database password privately.

### Step 2: Obtain the PostgreSQL Connection String (`DATABASE_URL`)
1. Open **Connect** (or **Project Settings → Database**) in Supabase.
2. Copy the **Session pooler** (port `5432`) or **Transaction pooler** (port `6543`) URI — recommended for Render Free IPv4 compatibility (`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`).

### Step 3: Create the Private Storage Bucket (`inkloomguard-files`)
1. Go to **Storage → New bucket** in Supabase.
2. Name the bucket **`inkloomguard-files`**.
3. Keep **Public bucket** **OFF** (private).

### Step 4: Configure Storage Permissions & Keys
1. Leave anonymous/public Storage policies disabled so unauthenticated users can never download files directly.
2. Go to **Project Settings → API Keys**, copy your **Project URL** (`SUPABASE_URL`) and your server-side **Secret key** (`sb_secret_...` or legacy `service_role` key) for `SUPABASE_SERVICE_ROLE_KEY`. Because the Express backend verifies JWT auth and `company_id` before downloading or issuing short-lived signed URLs, private bucket access stays strictly server-side.

### Step 5: Apply Database Migrations
Run `npm run db:migrate` locally with `DATABASE_URL` exported (or allow `initDatabase()` to apply pending files from `supabase/migrations/*.sql` automatically on startup). Confirm the migrated tables (`companies`, `users`, `user_sessions`, `brands`, `brand_visual_guidelines`, `brand_logo_variants`, `guideline_documents`, `brand_rules`, `approved_facts`, `terminology_rules`, `submissions`, `analysis_runs`, `compliance_issues`, `revisions`, `review_events`, `stored_files`, `password_reset_tokens`, `email_verification_tokens`, `revoked_tokens`, `schema_migrations`) appear in **Table Editor**.

### Step 6: Connect the GitHub Repository to Render
1. Push your codebase to your GitHub repository (confirm `.env` and `data/` are excluded via `.gitignore`).
2. In [Render](https://dashboard.render.com), click **New + → Web Service** (or **Blueprint** using `render.yaml`) and connect your GitHub repository.
3. Select the **Free** instance type.
4. Set:
   - **Build Command**: `npm install --include=dev --legacy-peer-deps && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`

### Step 7: Configure Render Environment Variables
Add these secrets privately in **Render → Environment** (never commit them):
- `NODE_ENV=production`
- `DATABASE_URL=<your-supabase-pooler-uri>`
- `SUPABASE_URL=https://<your-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<your-supabase-secret-key>`
- `SUPABASE_STORAGE_BUCKET=inkloomguard-files`
- `JWT_SECRET=<random-64-char-hex-string>`
- `GEMINI_API_KEY=<your-gemini-api-key>`
- `APP_BASE_URL=https://<your-render-service>.onrender.com`
- `BREVO_API_KEY=<your-brevo-transactional-api-key>` (uses Brevo HTTPS API over port 443; no outbound SMTP ports needed)
- `BREVO_SENDER_EMAIL=<verified-sender@your-domain>`
- `BREVO_SENDER_NAME=InkloomGuard AI`
- `CORS_ORIGINS=https://<your-render-service>.onrender.com` (update right after Render assigns your live URL)
- `ENABLE_DEMO_LOGIN=true` (optional; set to `true` to enable **Sign In to Pre-Seeded Organization (AetherFlow Systems)** in production; defaults to disabled in production when unset)
- `SEED_DEMO_WORKSPACE=true` (optional; set alongside `ENABLE_DEMO_LOGIN=true` to idempotently provision `AetherFlow Systems` once on startup with zero duplicates, or run `npm run db:seed:demo` from the CLI)

### Step 8: Set Up GitHub Actions
1. `.github/workflows/ci.yml` runs automatically on every push and pull request to `main`:
   - `bun install --frozen-lockfile` (using `bun.lock`)
   - `npm run lint` (`tsc --noEmit`)
   - `npm run build` (`vite build`)
   - `npm test` (`node tests/integration.test.ts`)
2. Optional auto-deploy webhook: If you prefer GitHub-triggered deploys instead of Render auto-deploy, add Render's Deploy Hook URL as GitHub repository secret `RENDER_DEPLOY_HOOK_URL` and set repository variable `ENABLE_RENDER_DEPLOY_HOOK=true`.

### Step 9: Deploy and Verify the Live Application
1. Trigger your initial deploy on Render.
2. Visit `https://<your-render-service>.onrender.com/api/health` and verify JSON output:
   `{"status":"ok","database":"connected","engine":"postgres","storage":"supabase","geminiConfigured":true,"emailConfigured":true,"demoAvailable":true,"demoStatus":"available","demoOrganizationName":"AetherFlow Systems"}` (or `"demoAvailable":false` when `ENABLE_DEMO_LOGIN` is not enabled).
3. Confirm `CORS_ORIGINS` matches your live Render URL and run the Section 34 persistence verification procedure below.

### Step 10: Back Up and Restore Application Data
- **PostgreSQL Backup**: Export logical backups using `pg_dump "$DATABASE_URL" --no-owner --no-acl -F c -f inkloomguard-backup.dump` (or Supabase's dashboard SQL/CSV exports on Free tier).
- **PostgreSQL Restore**: Restore safely into a clean database with `pg_restore --no-owner --no-acl -d "$NEW_DATABASE_URL" inkloomguard-backup.dump`.
- **Storage Backup**: Mirror files from private bucket `inkloomguard-files` using the Supabase CLI or Storage API alongside `stored_files` metadata so `storage_key` paths stay synchronized.

## 32. Database Persistence and Backup

In production, all relational data lives in **Supabase PostgreSQL** (`DATABASE_URL`). `data/` is never used when `DATABASE_URL` and `SUPABASE_*` are configured, and `server/db.ts` throws an explicit startup error if `NODE_ENV=production` runs without `DATABASE_URL`.

## 33. File Upload Storage

- Multer buffers uploads in memory (`10 MB` max for documents, logos, and submission images; `5 MB` max for avatars); Render's local disk is never used for uploaded files in production.
- `server/parsers.ts` validates magic bytes (`.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf`, `.docx`), `sharp` pixel limits (`40 MP` decompression bomb guard + avatar re-encoding), UTF-8 text (`.txt`, `.md`), and rejects active `<script>`/`<!ENTITY>`/`<iframe>`/`<object>`/`<embed>`/`javascript:`/`vbscript:`/`data:text/html`/`<foreignObject>`/`on*=` payloads in `.svg`.
- `server/storage.ts` uploads buffers into private Supabase bucket **`inkloomguard-files`** under `companies/<companyId>/brands/<brandId>/<assetKind>/<filename>` (or `companies/<companyId>/users/<userId>/user_avatar/<filename>` for avatars) and saves metadata in PostgreSQL `stored_files`.
- Downloads go through `GET /api/uploads/:filename` or `GET /api/uploads/id/:fileId` (plus `/signed-url` variants for 60s signed URLs) only after verifying JWT authentication and `company_id` ownership.

## 34. Testing Instructions

### Automated Local Integration Suite (PowerShell / Bash)

> `npm test` runs in an isolated temporary directory using SQLite and mocked Brevo `fetch` transport — it skips loading `.env` and never sends real emails.

```powershell
npm run lint
npm run build
npm test
```

### Local Email Verification End-to-End Test (Brevo HTTPS API)

1. Ensure `.env` has `NODE_ENV="development"`, `APP_BASE_URL="http://localhost:3000"`, `APP_URL="http://localhost:3000"`, and your real `BREVO_API_KEY` + verified `BREVO_SENDER_EMAIL`. Keep `DATABASE_URL` commented out to use local SQLite (`./data/inkloomguard.db`).
2. Start the app with `npm run dev` and confirm `[InkloomGuard AI] Email delivery ready: ... appBaseUrl=http://localhost:3000` appears in the terminal.
3. Open `http://localhost:3000` in your browser and switch to **Sign Up** (`POST /api/auth/register`) with a real inbox you can check.
4. Confirm you land on the **Email Verification Required** gate (protected workspace tabs stay gated until verified) and check your inbox for the Brevo verification email.
5. Verify the CTA URL inside the email points to `http://localhost:3000/?mode=verify-email&token=<64-hex-token>`.
6. Open that link in your browser — `VerifyEmailPage` calls `POST /api/auth/verify-email`, marks `email_verified = 1` in SQLite, consumes the single-use hashed token, and unlocks `/api/dashboard`.
7. Test **Resend Verification** (`POST /api/auth/resend-verification`) for another unverified email (rate limit: 3 requests per 15 minutes per IP) and confirm **Forgot Password** (`POST /api/auth/forgot-password`) still sends working `http://localhost:3000/?mode=reset-password&token=...` emails.

### Live Production Persistence Verification Procedure (Supabase + Render Free)
Run these steps against your live deployed URL `https://<your-app>.onrender.com`:
1. Register Company A (`reviewer` role) via **Sign Up** (`POST /api/auth/register`) and complete email verification.
2. Create a brand with a PNG/SVG logo (`POST /api/brands`).
3. Upload a PDF/DOCX/MD brand guideline document (`POST /api/guidelines/:brandId/upload`), extract/apply rules, and optionally configure Visual Brand Guidelines + logo variants.
4. Create a content submission with text and/or image (`POST /api/submissions`).
5. Confirm compliance analysis returns 8 check areas, visual detection overlays (if image included), and issues; save a revision (`POST /api/submissions/:id/revisions`).
6. Save a formal review decision (`POST /api/submissions/:id/review` -> `approved`) and check **Governance Analytics**.
7. **Restart / Redeploy** the Render Web Service from the Render dashboard (**Manual Deploy → Clear build cache & deploy** or **Restart**).
8. Refresh the live app, sign back in as Company A, and verify the brand logo/avatar renders, guideline rules persist, and the submission, issues, revision, analytics, and `approved` status are all intact.
9. Register Company B in a separate browser/incognito session and verify Company B receives `404`/`403` when attempting to access Company A's brand, submission, or `/api/uploads/:filename` asset.

## 35. Sample Test Organization and Brand

- **Pre-seeded Demo Organization**: `AetherFlow Systems` (created automatically in non-production when `companies` is empty; in production, enabled when `ENABLE_DEMO_LOGIN=true` and provisioned idempotently via `SEED_DEMO_WORKSPACE=true` or `npm run db:seed:demo`, accessible via **Sign In to Pre-Seeded Organization (AetherFlow Systems)**).
- **Recommended Verification Org**: `xyz` with brand `NovaPay` (`#4338CA` primary, `#06B6D4` secondary) and both `reviewer` and `author` accounts.

## 36. Troubleshooting

- **Startup error `DATABASE_URL must be configured in production`**: Set `DATABASE_URL` in Render Environment variables.
- **Startup error `Supabase Storage ... must be configured in production`**: Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET=inkloomguard-files` in Render Environment variables.
- **Startup error `JWT_SECRET environment variable must be configured in production`**: Set a random `>= 32`-character `JWT_SECRET` in Render Environment variables.
- **`401 Unauthorized` on `/api/dashboard`**: Ensure `JWT_SECRET` is consistent across restarts and your session wasn't revoked via logout, password reset, or **Sign Out All Devices**.
- **Render build peer dependency error**: Ensure Render Build Command uses `npm install --include=dev --legacy-peer-deps && npm run build` (already configured in `render.yaml`).

## 37. Security Considerations

- Passwords hashed with `bcryptjs` (`10` salt rounds); password hashes never returned in responses.
- Verification (`24h`) and password-reset (`30m`) tokens are stored only as SHA-256 hashes with constant-time comparison and composite tenant foreign keys.
- Bearer JWTs expire after 7 days and support immediate single-session and multi-device revocation via `jti`, `user_sessions`, `revoked_tokens`, and `token_version`.
- Rate limiting protects `/api/auth/login`, `/api/auth/register`, `/api/auth/demo`, `/api/auth/forgot-password`, `/api/auth/resend-verification`, and `/api/auth/verify-email`.
- Parameterized SQL queries throughout (`pg` `$1, $2...` / `node:sqlite` `?`) and strict positive-integer validation on numeric route IDs.
- Supabase `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `BREVO_API_KEY`, and `GEMINI_API_KEY` remain strictly server-side (`src/` never accesses backend secrets).
- Private bucket `inkloomguard-files` prevents public URL guessing; every download checks JWT auth + `company_id` + sanitized filename/storage key prefix.

## 38. Known Limitations

1. **Render Free Cold Starts**: Render Free spins down after 15 minutes of inactivity (~30–60s cold start on the next request; persisted data in Supabase is unaffected).
2. **In-Memory Auth Rate Limiter**: Uses a per-process `Map` suitable for single-instance Render Free; horizontal scaling requires Redis/external rate limiting.
3. **Team Member Invite UI**: `GET/POST /api/team/members` and `PUT /api/team/members/:memberId/role` enforce `reviewer`/`admin` management in **Settings → Organization / Workspace** (passwords for newly added teammates are set directly by the reviewer/admin rather than sent via email invite).
4. **Analytics Legacy Scan History & Cache Scope**: Pre-migration submissions without `analysis_runs` rows fall back cleanly to 1 initial scan + historical `reanalyzed` review events when charting scan volume, and the 20-second in-memory analytics cache invalidates per-process (`DATA_DIR` / single-instance Render).

## 39. Production Readiness Checklist

- [x] `npm run lint` (`tsc --noEmit`) passes with 0 errors
- [x] `npm run build` (`vite build`) produces `dist/` cleanly
- [x] `npm test` (`tests/integration.test.ts`) passes locally
- [x] `supabase/migrations/0001` through `0010` created idempotently for Supabase PostgreSQL
- [x] Private Supabase Storage bucket `inkloomguard-files` integration & production fail-fast guards implemented
- [x] Brevo HTTPS verification & password-reset flows, Visual Brand Detection, Profile Picture Editor, Settings & Governance Analytics implemented
- [x] `render.yaml`, `.github/workflows/ci.yml`, and `.env.example` configured
- [ ] Run `npm run db:migrate` against your Supabase `DATABASE_URL` (or let `initDatabase()` apply pending migrations on startup)
- [ ] Push to GitHub and configure Render Free environment variables privately in the Render dashboard
- [ ] Execute the 9-step Live Production Persistence Verification procedure and visual UI checks in the browser after deploying
