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

InkloomGuard AI combines deterministic rule enforcement (exact terminology matching, SLA percentage checks, promotional superlative flags, WCAG readability/heading/alt-text checks, and pixel-level color/luminance analysis) with Gemini LLM evaluation (`gemini-4-hydrogen`) strictly grounded in each brand's saved rules and approved company facts. Every organization operates inside an isolated tenant boundary with role-based governance (`reviewer` vs `author`).

In production (Render Free), all application records persist in **Supabase PostgreSQL** (`DATABASE_URL`) and all uploaded brand logos, guideline documents, and submission visual assets persist in your private **Supabase Storage** bucket (`inkloomguard-files`) with zero dependency on Render's ephemeral local filesystem. For local development without cloud credentials, the backend automatically falls back to local SQLite and `DATA_DIR/uploads/`.

## 3. Main Features

- **Multi-Tenant Organization Workspaces**: Isolated companies, brands, guideline documents, submissions, issues, revisions, audit logs, and uploaded files.
- **Dual-Mode Persistent Database & Storage**: Production uses **Supabase PostgreSQL** (`DATABASE_URL`) and **Supabase Private Storage** (`inkloomguard-files`) with `stored_files` metadata tracking; local dev falls back cleanly to SQLite + `DATA_DIR/uploads/`.
- **Bearer JWT Auth & Server-Side Token Revocation**: Stateless signed JWTs with `jti` identifiers backed by `revoked_tokens` on logout.
- **Role-Based Access Control (RBAC)**: Separation between `reviewer` (formal approvals, rejections, change requests, brand deletion, team member creation) and `author` (submissions, revisions, comments).
- **Guideline Parsing & Gemini Structured Extraction**: Extracts text from PDF, DOCX, TXT, and Markdown files in memory and populates `brand_rules`, `approved_facts`, and `terminology_rules`.
- **Eight-Area Hybrid Compliance Engine**: Audits `Brand Tone`, `Terminology`, `Brand Messaging`, `Facts`, `Promotional Claims`, `Visual Identity`, `Accessibility`, and `Governance`, marking unrun checks explicitly as `not_performed`.
- **Side-by-Side Corrections & Versioned Revisions**: Accept/reject findings, edit revised drafts without mutating `original_content`, and track full revision history.
- **Claymorphic Light & Dark UI**: Full light/dark theme toggle, `⌘K`/`Ctrl+K` quick submission search, and authenticated asset rendering via `<ProtectedImage />`.

## 4. Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Lucide React icons (`lucide-react`), Motion (`motion`).
- **Backend**: Node.js `v22+`, Express 4 (`express`), Multer (`multer` memory storage), JSON Web Tokens (`jsonwebtoken`), bcryptjs (`bcryptjs`).
- **Database**: **Supabase PostgreSQL** (`pg` pool via `DATABASE_URL`) in production; Node built-in SQLite (`node:sqlite` `DatabaseSync`) in local development when `DATABASE_URL` is unset.
- **File Storage**: **Supabase Private Storage** (`@supabase/supabase-js` bucket `inkloomguard-files`) in production; local `DATA_DIR/uploads/` in local development only.
- **Document & Image Processing**: `pdf-parse` v2 (`PDFParse` for PDF), `mammoth` (DOCX), `jimp` v1 (in-memory pixel color/luminance/contrast analysis).
- **AI Integration**: `@google/genai` SDK calling `gemini-4-hydrogen` server-side via `GEMINI_API_KEY`.
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
│   ├── parsers.ts                     # In-memory magic-byte/SVG validation, PDF/DOCX/TXT/Image parsers
│   ├── routes.ts                      # All REST API endpoints (/api/*)
│   └── storage.ts                     # Supabase Storage (inkloomguard-files) & local fallback abstraction
├── supabase/migrations/
│   ├── 0001_initial_schema.sql        # Idempotent PostgreSQL core tables & indexes
│   └── 0002_storage_metadata.sql      # Idempotent PostgreSQL stored_files metadata table
├── scripts/
│   ├── migrate-postgres.ts            # Safe CLI runner applying supabase/migrations/*.sql
│   └── migrate-sqlite-to-postgres.ts  # Non-destructive SQLite -> Supabase Postgres & Storage migrator
├── tests/
│   └── integration.test.ts            # Automated API, RBAC, upload validation & tenant-isolation suite
└── src/
    ├── App.tsx                        # Root shell, session gate, navigation, Quick Search (⌘K)
    ├── api.ts                         # Typed fetch wrapper, Bearer storage, response validation
    ├── index.css                      # Tailwind v4 + Claymorphic Light & Dark design tokens
    ├── main.tsx                       # React root mount
    ├── types.ts                       # Shared TypeScript interfaces
    ├── assets/images/                 # Static UI emblem & avatar assets
    ├── components/ClayUI.tsx          # StatusBadge, SeverityBadge, ThemeToggle, ProtectedImage
    └── pages/                         # Auth, Dashboard, Guidelines, Submit, Analysis, Corrections, Review, History
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
- **`users`**: `id`, `company_id -> companies.id`, `name`, `email (UNIQUE)`, `password_hash`, `role` (`'reviewer' | 'author'`), `created_at`.
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

Two workspace roles exist (`reviewer` and `author`):

- **`reviewer`**: Full read/write access across brands, guidelines, submissions, revisions, comments, formal review decisions (`approved`, `rejected`, `changes_requested`), brand deletion (`DELETE /api/brands/:id`), and creating same-org teammates (`POST /api/team/members`).
- **`author`**: Can view organization brands/guidelines/history, upload guidelines, submit content, resolve issue suggestions, save revisions, and post governance comments (`decision: 'comment'`). Blocked with `403 Forbidden` on formal review decisions, brand deletion, and team member creation (`requireRole('reviewer')` and explicit backend checks).

## 13. Brand Creation Workflow

From **Dashboard → Add Brand** (or `POST /api/brands`), users provide `name`, `industry`, `primaryColor` (default `#4F46E5`), `secondaryColor` (default `#06B6D4`), and an optional logo file. Creating a brand also initializes its `brand_rules` row (`tone_rules: ''`, `messaging_rules: ''`).

## 14. Company Logo Upload

- Allowed extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg` (up to `10 MB`).
- Validated both by extension and file content/magic bytes (`validateUploadedFileContent`), rejecting SVG files containing `<script>`, `javascript:`, `data:text/html`, `<foreignObject>`, or inline `on*=` attributes.
- Rendered in the UI via `<ProtectedImage />` using `fetchProtectedAssetBlobUrl()` with Bearer authentication.

## 15. Brand Guideline Document Upload

On **Brand Guidelines**, uploading a `.pdf`, `.docx`, `.txt`, or `.md` file (`POST /api/guidelines/:brandId/upload`) validates magic bytes/UTF-8 text, extracts raw text via `pdf-parse` (`PDFParse`), `mammoth`, or UTF-8 decode, and saves the document record in `guideline_documents`.

## 16. AI Brand Requirement Extraction

When `autoExtract=true` on upload or when clicking **Extract Rules** (`POST /api/guidelines/:brandId/ai-extract/:docId`), `extractStructuredGuidelinesFromText()` sends up to 24,000 characters of the document to `gemini-4-hydrogen` with exponential-backoff retries (`generateContentWithRetry`, up to 3 attempts on transient `503`/`429` errors) and a strict JSON schema (`toneRules`, `messagingRules`, `facts`, `terminology`). If `GEMINI_API_KEY` is missing or Gemini fails, `formatGeminiError()` returns a clear human-readable `503`/`429`/`500` error rather than fabricating rules.

## 17. Structured Brand Requirement Storage

Extracted (or manually entered) requirements are persisted in three separate tenant-scoped tables:

- `brand_rules`: Voice/tone rules and messaging pillars (`PUT /api/guidelines/:brandId/rules`).
- `approved_facts`: Key-value facts with source attribution (`POST /api/guidelines/:brandId/facts`).
- `terminology_rules`: Prohibited term, preferred replacement, severity (`critical | high | medium | low`), and notes (`POST /api/guidelines/:brandId/terminology`).

## 18. Content Submission Workflow

On **Submit Content**, users select a brand, provide a title, and supply pasted copy, a `.pdf`/`.docx`/`.txt`/`.md` document, and/or an image (`.png`, `.jpg`, `.jpeg`, `.webp`) with optional alt text (`POST /api/submissions`). Original pasted/extracted text is preserved permanently in `submissions.original_content`.

## 19. Compliance Analysis Engine

`runFullComplianceAnalysis()` (`server/complianceEngine.ts`) evaluates eight areas:

1. **Brand Tone** (Gemini `gemini-4-hydrogen` grounded in `brand_rules.tone_rules`; `not_performed` if empty or AI unavailable).
2. **Terminology** (Deterministic word-boundary regex matching against `terminology_rules`, case-sensitive when casing differs).
3. **Brand Messaging** (Gemini `gemini-4-hydrogen` grounded in `brand_rules.messaging_rules`; `not_performed` if empty or AI unavailable).
4. **Facts** (Deterministic SLA/percentage contradiction checks + Gemini comparison against `approved_facts`).
5. **Promotional Claims** (Deterministic regex for unsubstantiated superlatives/guarantees + Gemini claim detection).
6. **Visual Identity** (Jimp pixel sampling comparing dominant hex colors against `primary_color`/`secondary_color` + Gemini Vision evaluation when configured).
7. **Accessibility** (Deterministic alt-text presence/quality, Jimp luminance contrast spread `>= 3.0:1`, heading hierarchy jump checks, and >45-word sentence readability checks).
8. **Governance** (Tracks pending review state and updates on human reviewer decisions).

## 20. Correction Suggestions

On **Correction Suggestions**, each finding from `compliance_issues` can be marked `accepted`, `rejected`, or `open` via `POST /api/submissions/:id/issues/:issueId/resolve`. Accepting a suggestion replaces matching `original_text` inside the working draft editor without altering `original_content`.

## 21. Revision Management

Saving in **Correction Suggestions** calls `POST /api/submissions/:id/revisions`, which inserts an immutable snapshot in `revisions`, updates `submissions.revised_content`, transitions status to `pending_review`, and logs a `revision_saved` entry in `review_events`.

## 22. Review and Approval Workflow

On **Review & Approval**, `POST /api/submissions/:id/review` accepts `approved`, `rejected`, `changes_requested` (`reviewer` role only), or `comment` (`author` or `reviewer`). Formal decisions update `submissions.status` and the `Governance` summary inside `checks_summary_json`, and append an immutable record to `review_events`.

## 23. Review History

**Review History** loads all organization submissions with search by title/brand, status filter tabs (`All`, `Pending Review`, `Approved`, `Changes Requested`, `Rejected`), and an inspection modal displaying original vs revised copy, issues/evidence, revisions, and review events.

## 24. API Endpoint Reference

| Method | Endpoint | Auth | Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | Any | Health check (`status`, `database`, `engine`, `storage`, `geminiConfigured`) |
| `POST` | `/api/auth/register` | Public | Any | Create organization + initial user; returns `{ user, token }` |
| `POST` | `/api/auth/login` | Public | Any | Authenticate email/password; returns `{ user, token }` |
| `POST` | `/api/auth/demo` | Public | Any | Sign in to seeded `AetherFlow Systems` workspace |
| `POST` | `/api/auth/logout` | Optional Bearer | Any | Revoke current JWT `jti` in `revoked_tokens` |
| `GET` | `/api/auth/me` | Bearer | Any | Verify token and return `{ user }` |
| `GET` | `/api/team/members` | Bearer | Any | List users in caller's organization |
| `POST` | `/api/team/members` | Bearer | `reviewer` | Create `author` or `reviewer` user in caller's org |
| `GET` | `/api/uploads/:filename` | Bearer | Any | Stream tenant-owned asset from Supabase Storage (`inkloomguard-files`) or local dev storage |
| `GET` | `/api/uploads/:filename/signed-url` | Bearer | Any | Issue 60s signed Supabase Storage URL after tenant verification |
| `GET` | `/api/dashboard` | Bearer | Any | Return KPI metrics, org brands, and 12 recent review events |
| `GET` | `/api/brands` | Bearer | Any | List organization brands |
| `POST` | `/api/brands` | Bearer | Any | Create brand + optional logo upload (`multipart/form-data`) |
| `PUT` | `/api/brands/:id` | Bearer | Any | Update brand profile / logo |
| `DELETE` | `/api/brands/:id` | Bearer | `reviewer` | Delete brand, cascading rows, and backing storage objects |
| `GET` | `/api/guidelines/:brandId` | Bearer | Any | Fetch brand docs, facts, terminology, and rules |
| `POST` | `/api/guidelines/:brandId/upload` | Bearer | Any | Upload PDF/DOCX/TXT/MD guideline; optional `autoExtract` |
| `POST` | `/api/guidelines/:brandId/ai-extract/:docId` | Bearer | Any | Run Gemini structured extraction on an uploaded doc |
| `PUT` | `/api/guidelines/:brandId/rules` | Bearer | Any | Save `tone_rules` and `messaging_rules` |
| `POST` | `/api/guidelines/:brandId/facts` | Bearer | Any | Add approved company fact |
| `DELETE` | `/api/guidelines/:brandId/facts/:factId` | Bearer | Any | Delete approved company fact |
| `POST` | `/api/guidelines/:brandId/terminology` | Bearer | Any | Add prohibited/preferred terminology rule |
| `DELETE` | `/api/guidelines/:brandId/terminology/:ruleId` | Bearer | Any | Delete terminology rule |
| `GET` | `/api/submissions` | Bearer | Any | List org submissions with issue counts & latest decision |
| `GET` | `/api/submissions/:id` | Bearer | Any | Fetch submission, issues, revisions, and review events |
| `POST` | `/api/submissions` | Bearer | Any | Submit text/doc/image and execute 8-area compliance scan |
| `POST` | `/api/submissions/:id/issues/:issueId/resolve` | Bearer | Any | Mark issue `accepted`, `rejected`, or `open` |
| `POST` | `/api/submissions/:id/revisions` | Bearer | Any | Save revised draft without overwriting original copy |
| `POST` | `/api/submissions/:id/review` | Bearer | `reviewer` (decisions) / Any (`comment`) | Record approval, rejection, change request, or comment |

## 25. Environment Variables

All environment variables are **backend-only**. Never prefix database URLs, Supabase secret keys, or API keys with `VITE_`.

| Variable | Required in Production | Purpose |
| :--- | :--- | :--- |
| `DATABASE_URL` | **Yes** | Supabase PostgreSQL connection string (Pooler URI). Required when `NODE_ENV=production`. |
| `SUPABASE_URL` | **Yes** | Supabase project URL (`https://<ref>.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase server-side secret key (`sb_secret_...` or legacy `service_role` JWT). Used strictly on the backend to access private bucket `inkloomguard-files`. |
| `SUPABASE_STORAGE_BUCKET` | **Yes** | Private Supabase Storage bucket name: `inkloomguard-files`. |
| `JWT_SECRET` | **Yes** | Random secret (`>= 32` chars) used to sign/verify Bearer JWTs across restarts. |
| `GEMINI_API_KEY` | **Yes** (for AI checks) | Google Gemini API key used server-side for guideline extraction and compliance analysis. |
| `NODE_ENV` | **Yes** (`production`) | Serves pre-built `dist/` SPA and enforces persistent Postgres + Supabase Storage in production. |
| `PORT` | Injected by Render | HTTP bind port (`process.env.PORT`, defaults to `3000` locally). |
| `CORS_ORIGINS` | Recommended after deploy | Comma-separated production origins (e.g. `https://inkloomguard-ai.onrender.com`). `APP_URL` and `RENDER_EXTERNAL_URL` are also accepted. |
| `DATA_DIR` | Local Dev Only | Directory for local SQLite + local upload fallback when Supabase env vars are unset. Never used in production. |

## 26. Local Development Setup

Prerequisites:
- Node.js `v22.18+` (tested on `v22.23.2`)
- `bun` (`v1.4+`) or `npm`

Copy `.env.example` to `.env` (never commit `.env`):

```bash
cp .env.example .env
```

To test against Supabase locally, fill in `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=inkloomguard-files`, `JWT_SECRET`, and `GEMINI_API_KEY` in `.env`. Leave `DATABASE_URL` and `SUPABASE_*` unset to develop against local SQLite + `DATA_DIR/uploads/`.

## 27. Installation Commands

```bash
bun install --frozen-lockfile
# or with npm:
npm install --include=dev --legacy-peer-deps
```

## 28. Database Setup and Migrations

### Safe Automatic & CLI PostgreSQL Migrations
Idempotent SQL migrations live in `supabase/migrations/`:
- `supabase/migrations/0001_initial_schema.sql` — creates all 12 core tables and 9 indexes using `IF NOT EXISTS`.
- `supabase/migrations/0002_storage_metadata.sql` — creates `stored_files` and indexes for company/brand file ownership.

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

**Development mode** (Express + Vite middleware on `http://localhost:3000`):

```bash
npm run dev
```

**Production simulation locally**:

```bash
npm run build
NODE_ENV=production npm start
```

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
Run `npm run db:migrate` locally with `DATABASE_URL` exported (or run `supabase/migrations/0001_initial_schema.sql` and `0002_storage_metadata.sql` inside the Supabase **SQL Editor**). Confirm all 13 tables (`companies`, `users`, ..., `stored_files`, `schema_migrations`) appear in **Table Editor**.

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
- `CORS_ORIGINS=https://<your-render-service>.onrender.com` (update right after Render assigns your live URL)

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
   `{"status":"ok","database":"connected","engine":"postgres","storage":"supabase","geminiConfigured":true,...}`
3. Confirm `CORS_ORIGINS` matches your live Render URL and run the Section 34 persistence verification procedure below.

### Step 10: Back Up and Restore Application Data
- **PostgreSQL Backup**: Export logical backups using `pg_dump "$DATABASE_URL" --no-owner --no-acl -F c -f inkloomguard-backup.dump` (or Supabase's dashboard SQL/CSV exports on Free tier).
- **PostgreSQL Restore**: Restore safely into a clean database with `pg_restore --no-owner --no-acl -d "$NEW_DATABASE_URL" inkloomguard-backup.dump`.
- **Storage Backup**: Mirror files from private bucket `inkloomguard-files` using the Supabase CLI or Storage API alongside `stored_files` metadata so `storage_key` paths stay synchronized.

## 32. Database Persistence and Backup

In production, all relational data lives in **Supabase PostgreSQL** (`DATABASE_URL`). `data/` is never used when `DATABASE_URL` and `SUPABASE_*` are configured, and `server/db.ts` throws an explicit startup error if `NODE_ENV=production` runs without `DATABASE_URL`.

## 33. File Upload Storage

- Multer buffers uploads in memory (`10 MB` max); Render's local disk is never used for uploaded files in production.
- `server/parsers.ts` validates magic bytes (`.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf`, `.docx`), UTF-8 text (`.txt`, `.md`), and rejects active `<script>`/`javascript:`/`on*=` attributes in `.svg`.
- `server/storage.ts` uploads buffers into private Supabase bucket **`inkloomguard-files`** under `companies/<companyId>/brands/<brandId>/<assetKind>/<filename>` and saves metadata (`original_name`, `mime_type`, `size_bytes`, `storage_key`) in PostgreSQL `stored_files`.
- Downloads go through `GET /api/uploads/:filename` (or `GET /api/uploads/:filename/signed-url` for 60s signed URLs) only after verifying JWT authentication and `company_id` ownership.

## 34. Testing Instructions

### Automated Local Integration Suite

```bash
npm run lint
npm run build
npm test
```

### Live Production Persistence Verification Procedure (Supabase + Render Free)
Run these steps against your live deployed URL `https://<your-app>.onrender.com`:
1. Register Company A (`reviewer` role) via **Sign Up** (`POST /api/auth/register`).
2. Create a brand with a PNG/SVG logo (`POST /api/brands`).
3. Upload a PDF/DOCX/MD brand guideline document (`POST /api/guidelines/:brandId/upload`), extract/save rules, facts, and terminology.
4. Create a content submission with text and/or image (`POST /api/submissions`).
5. Confirm compliance analysis returns check areas and issues; save a revision (`POST /api/submissions/:id/revisions`).
6. Save a formal review decision (`POST /api/submissions/:id/review` -> `approved`).
7. **Restart / Redeploy** the Render Web Service from the Render dashboard (**Manual Deploy → Clear build cache & deploy** or **Restart**).
8. Refresh the live app, sign back in as Company A, and verify the brand logo renders (`GET /api/uploads/:filename`), the guideline document text and rules persist, and the submission, issues, revision, and `approved` status are all intact.
9. Register Company B in a separate browser/incognito session and verify Company B receives `404`/`403` when attempting to access Company A's brand, submission, or `/api/uploads/:filename` asset.

## 35. Sample Test Organization and Brand

- **Pre-seeded Demo Organization**: `AetherFlow Systems` (created automatically only when `companies` is empty; accessible via **Sign In to Pre-Seeded Organization**).
- **Recommended Hackathon Verification Org**: `xyz` with brand `NovaPay` (`#4338CA` primary, `#06B6D4` secondary) and both `reviewer` and `author` accounts.

## 36. Troubleshooting

- **Startup error `DATABASE_URL must be configured in production`**: Set `DATABASE_URL` in Render Environment variables.
- **Startup error `Supabase Storage ... must be configured in production`**: Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET=inkloomguard-files` in Render Environment variables.
- **`401 Unauthorized` on `/api/dashboard`**: Ensure `JWT_SECRET` is set consistently in Render (without it, restarts generate a new secret) and token wasn't revoked via logout.
- **Render build peer dependency error**: Ensure Render Build Command uses `npm install --include=dev --legacy-peer-deps && npm run build` (already configured in `render.yaml`).

## 37. Security Considerations

- Passwords hashed with `bcryptjs` (`10` salt rounds); password hashes never returned in responses.
- Bearer JWTs expire after 7 days and support immediate revocation via `jti` + `revoked_tokens`.
- Rate limiting (`60` requests / `5 minutes` per IP) protects `/api/auth/login`, `/api/auth/register`, and `/api/auth/demo`.
- Parameterized SQL queries throughout (`pg` `$1, $2...` / `node:sqlite` `?`).
- Supabase `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` remain strictly server-side (`src/` never imports `@supabase/supabase-js` or reads backend env vars).
- Private bucket `inkloomguard-files` prevents public URL guessing; every download checks JWT auth + `company_id` + sanitized filename.

## 38. Known Limitations

1. **Render Free Cold Starts**: Render Free spins down after 15 minutes of inactivity (~30–60s cold start on the next request; persisted data in Supabase is unaffected).
2. **In-Memory Auth Rate Limiter**: Uses a per-process `Map` suitable for single-instance Render Free; horizontal scaling requires Redis/external rate limiting.
3. **Team Member Invite UI**: `GET/POST /api/team/members` enforces reviewer-only team creation on the backend, while no Team Management UI modal currently exists in the React frontend.

## 39. Production Readiness Checklist

- [x] `npm run lint` (`tsc --noEmit`) passes with 0 errors
- [x] `npm run build` (`vite build`) produces `dist/` cleanly
- [x] `npm test` (`tests/integration.test.ts`) passes locally
- [x] `supabase/migrations/0001_initial_schema.sql` & `0002_storage_metadata.sql` created for Supabase PostgreSQL
- [x] Private Supabase Storage bucket `inkloomguard-files` integration & production fail-fast guards implemented
- [x] `render.yaml`, `.github/workflows/ci.yml`, and `.env.example` configured
- [ ] Run `npm run db:migrate` against your Supabase `DATABASE_URL` (or run migration SQL in Supabase SQL Editor)
- [ ] Push to GitHub and configure Render Free environment variables privately in the Render dashboard
- [ ] Execute the 9-step Live Production Persistence Verification procedure after Render deploys
