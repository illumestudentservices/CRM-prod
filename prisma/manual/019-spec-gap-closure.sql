-- Close remaining spec gaps across Students, Clients, Recruitment Network,
-- and Field Operations. Purely additive: no drops, no NOT NULL on existing
-- columns, no destructive enum removal. Legacy enum values are retained and
-- either remapped by backfill or left in place for reader compatibility.
--
-- Run this migration INSTEAD OF `prisma db push` for this change. Push would
-- try to reconcile enum ordering and would not run the remaps. The Node/Prisma
-- clients only need to be regenerated after this runs.
--
-- Idempotent: every ALTER TABLE ADD COLUMN uses IF NOT EXISTS, every
-- CREATE TYPE / CREATE TABLE / CREATE INDEX is guarded, every FK creation is
-- wrapped in a DO block that catches duplicate_object.

-- ── 1. Enum additions (must run OUTSIDE a transaction on some Postgres
--    versions when the enum is used later in the same script). Each is
--    idempotent so re-runs are safe.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNT_MANAGER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMISSIONS_SUPPORT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'VP_GLOBAL_SALES';

ALTER TYPE "LeadStage" ADD VALUE IF NOT EXISTS 'WITHDRAWN';
ALTER TYPE "LeadStage" ADD VALUE IF NOT EXISTS 'VISA_REFUSED';

ALTER TYPE "LeadLostReason" ADD VALUE IF NOT EXISTS 'CHOSE_NON_ILLUME';
ALTER TYPE "LeadLostReason" ADD VALUE IF NOT EXISTS 'ENGLISH';
ALTER TYPE "LeadLostReason" ADD VALUE IF NOT EXISTS 'CHANGED_PLANS';

ALTER TYPE "ApplicationSubmissionMethod" ADD VALUE IF NOT EXISTS 'UNIVERSITY_PORTAL';
ALTER TYPE "ApplicationSubmissionMethod" ADD VALUE IF NOT EXISTS 'AGENT_PORTAL';
ALTER TYPE "ApplicationSubmissionMethod" ADD VALUE IF NOT EXISTS 'INTERNAL';

ALTER TYPE "OfferType" ADD VALUE IF NOT EXISTS 'ALTERNATIVE_PROGRAMME';
ALTER TYPE "OfferType" ADD VALUE IF NOT EXISTS 'WAITLIST';
ALTER TYPE "OfferType" ADD VALUE IF NOT EXISTS 'OTHER';

ALTER TYPE "StudentDecision" ADD VALUE IF NOT EXISTS 'INTENDS_TO_ACCEPT';
ALTER TYPE "StudentDecision" ADD VALUE IF NOT EXISTS 'CONSIDERING';
ALTER TYPE "StudentDecision" ADD VALUE IF NOT EXISTS 'AWAITING_OTHERS';
ALTER TYPE "StudentDecision" ADD VALUE IF NOT EXISTS 'REQUESTING_DEFERRAL';

ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'REFERRAL_PARTNER';
ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'EDUCATION_PARTNER';

ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'ONBOARDING';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'SCHOOL_FAIR';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'SCHOOL_VISIT';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'OPEN_DAY';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'AGENT_WORKSHOP';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'STUDENT_SEMINAR';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'CONVERSION_EVENT';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'APPLICATION_DAY';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'OTHER';

ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

ALTER TYPE "AgentTier" ADD VALUE IF NOT EXISTS 'INACTIVE';

ALTER TYPE "RelationshipStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "RelationshipStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'AGENT_TRAINING';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'SCHOOL_PRESENTATION';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CLIENT_MEETING';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'MARKET_RESEARCH';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'STUDENT_FOLLOW_UP_SESSION';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'EVENT_PREPARATION';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'EVENT_FOLLOW_UP';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'REPORT_SUBMISSION';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'DELEGATION_SUPPORT';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'INTERNAL_REVIEW';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OTHER';

-- ── 2. New enum types ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "CounsellingOutcome" AS ENUM (
    'PROCEED_TO_ELIGIBILITY',
    'FURTHER_COUNSELLING_REQUIRED',
    'NOT_READY_YET',
    'UNABLE_TO_CONTACT',
    'NOT_SUITABLE',
    'LOST',
    'DEFERRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EnrolmentStatus" AS ENUM (
    'ENROLLED',
    'REGISTERED',
    'STARTED_STUDIES',
    'DID_NOT_ARRIVE',
    'WITHDREW_BEFORE_START',
    'DEFERRED_AFTER_DEPOSIT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DepositStatus" AS ENUM (
    'NOT_REQUIRED',
    'PENDING',
    'PAID',
    'PARTIALLY_PAID',
    'WAIVED',
    'REFUNDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LeadChannel" AS ENUM (
    'AGENT_REFERRAL',
    'SCHOOL_REFERRAL',
    'WEBSITE',
    'WALK_IN',
    'STUDENT_REFERRAL',
    'STAFF_REFERRAL',
    'GOOGLE_ADS',
    'META_ADS',
    'ORGANIC_SOCIAL',
    'QR_CODE',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AccountHealth" AS ENUM ('GREEN', 'AMBER', 'RED', 'GREY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssueCategory" AS ENUM (
    'CLIENT_RELATIONSHIP', 'SERVICE_DELIVERY', 'RECRUITMENT_PERFORMANCE',
    'STAFFING', 'CONTRACT', 'FINANCE', 'COMPLIANCE', 'TECHNOLOGY',
    'STUDENT_CASE', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssueStatus" AS ENUM (
    'OPEN', 'IN_PROGRESS', 'AWAITING_CLIENT', 'AWAITING_INTERNAL_ACTION',
    'RESOLVED', 'CLOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ServiceScope" AS ENUM (
    'IN_COUNTRY_REPRESENTATION', 'STUDENT_RECRUITMENT', 'AGENT_ENGAGEMENT',
    'SCHOOL_ENGAGEMENT', 'EVENTS_AND_FAIRS', 'MARKETING_SUPPORT',
    'APPLICATION_SUPPORT', 'CONVERSION_SUPPORT', 'MARKET_INTELLIGENCE',
    'REPORTING', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportingFrequency" AS ENUM (
    'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'AD_HOC'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContactCategory" AS ENUM (
    'INTERNATIONAL_RECRUITMENT', 'ADMISSIONS', 'MARKETING', 'FINANCE',
    'CONTRACTS_PROCUREMENT', 'SENIOR_LEADERSHIP', 'FACULTY_ACADEMIC', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContractStatus" AS ENUM (
    'DRAFT', 'UNDER_REVIEW', 'ACTIVE', 'RENEWAL_PENDING',
    'EXPIRED', 'TERMINATED', 'SUPERSEDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContractType" AS ENUM (
    'MASTER_SERVICES', 'RECRUITMENT', 'REPRESENTATION',
    'ADDENDUM', 'RENEWAL', 'MOU', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DocumentCategory" AS ENUM (
    'CONTRACTS', 'PROPOSALS', 'REPORTS', 'MEETING_MINUTES',
    'MARKETING_MATERIALS', 'BRAND_ASSETS', 'ACTIVITY_EVIDENCE',
    'FINANCIAL_DOCUMENTS', 'COMPLIANCE_DOCUMENTS', 'PRESENTATIONS', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AccountRole" AS ENUM (
    'ACCOUNT_MANAGER', 'REGIONAL_MANAGER', 'ICR', 'CLIENT_RELATIONS',
    'MARKETING_SUPPORT', 'ADMISSIONS_SUPPORT', 'SENIOR_OVERSIGHT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CampaignStatus" AS ENUM (
    'PLANNED', 'APPROVED', 'OPEN', 'COMPLETED', 'CLOSED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ActivityStatus" AS ENUM (
    'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Column additions ────────────────────────────────────────────────────
-- ALTER TABLE ADD COLUMN IF NOT EXISTS is supported on Postgres 9.6+.

-- Lead: dedup keys + attribution pinning + channel + counselling enum
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "dateOfBirth"    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "passportNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "originalSourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "originalEventId"  TEXT,
  ADD COLUMN IF NOT EXISTS "firstTouchDate"   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "channel"          "LeadChannel",
  ADD COLUMN IF NOT EXISTS "counsellingOutcomeEnum" "CounsellingOutcome";

-- InstitutionInterest: enrolment status
ALTER TABLE "institution_interests"
  ADD COLUMN IF NOT EXISTS "enrolmentStatus" "EnrolmentStatus";

-- LeadApplication: deposit lifecycle + appeal + rejection date
ALTER TABLE "lead_applications"
  ADD COLUMN IF NOT EXISTS "depositStatus"   "DepositStatus",
  ADD COLUMN IF NOT EXISTS "depositAmount"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "depositCurrency" TEXT,
  ADD COLUMN IF NOT EXISTS "appealPossible"  BOOLEAN,
  ADD COLUMN IF NOT EXISTS "rejectionDate"   TIMESTAMP;

-- LeadDocument: institutionInterestId for per-journey scoping
ALTER TABLE "lead_documents"
  ADD COLUMN IF NOT EXISTS "institutionInterestId" TEXT;

-- Institution: legalName, health, service scope, reporting freq, RM
ALTER TABLE "institutions"
  ADD COLUMN IF NOT EXISTS "legalName"          TEXT,
  ADD COLUMN IF NOT EXISTS "accountHealth"      "AccountHealth" DEFAULT 'GREY',
  ADD COLUMN IF NOT EXISTS "reportingFrequency" "ReportingFrequency",
  ADD COLUMN IF NOT EXISTS "serviceScope"       "ServiceScope"[] DEFAULT ARRAY[]::"ServiceScope"[],
  ADD COLUMN IF NOT EXISTS "regionalManagerId"  TEXT;

-- InstitutionUser: proper assignment record
ALTER TABLE "institution_users"
  ADD COLUMN IF NOT EXISTS "accountRole"         "AccountRole",
  ADD COLUMN IF NOT EXISTS "region"              TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentStartDate" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "assignmentStatus"    "AssignmentStatus" DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "notes"               TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt"           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt"           TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- InstitutionContact: category / department / owner / isActive
ALTER TABLE "institution_contacts"
  ADD COLUMN IF NOT EXISTS "category"            "ContactCategory",
  ADD COLUMN IF NOT EXISTS "department"          TEXT,
  ADD COLUMN IF NOT EXISTS "relationshipOwnerId" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive"            BOOLEAN DEFAULT true;

-- Contract: full enrichment per spec §6
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "statusEnum"       "ContractStatus",
  ADD COLUMN IF NOT EXISTS "type"             "ContractType",
  ADD COLUMN IF NOT EXISTS "noticePeriodDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "ownerId"          TEXT,
  ADD COLUMN IF NOT EXISTS "currency"         TEXT,
  ADD COLUMN IF NOT EXISTS "paymentStructure" TEXT,
  ADD COLUMN IF NOT EXISTS "supersededById"   TEXT;

-- InstitutionDocument: category / expiry / version / related records
ALTER TABLE "institution_documents"
  ADD COLUMN IF NOT EXISTS "category"   "DocumentCategory",
  ADD COLUMN IF NOT EXISTS "expiresAt"  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "version"    TEXT,
  ADD COLUMN IF NOT EXISTS "contractId" TEXT,
  ADD COLUMN IF NOT EXISTS "issueId"    TEXT,
  ADD COLUMN IF NOT EXISTS "activityId" TEXT;

-- Campaign: full enrichment per spec §12
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "type"               TEXT,
  ADD COLUMN IF NOT EXISTS "country"            TEXT,
  ADD COLUMN IF NOT EXISTS "city"               TEXT,
  ADD COLUMN IF NOT EXISTS "venue"              TEXT,
  ADD COLUMN IF NOT EXISTS "expectedAttendance" INTEGER,
  ADD COLUMN IF NOT EXISTS "actualAttendance"   INTEGER,
  ADD COLUMN IF NOT EXISTS "eventOrganizer"     TEXT,
  ADD COLUMN IF NOT EXISTS "status"             "CampaignStatus",
  ADD COLUMN IF NOT EXISTS "outcomeSummary"     TEXT,
  ADD COLUMN IF NOT EXISTS "ownerId"            TEXT;

-- Activity: status + planAlignment + actualDate + outcomeSummary + follow-up
-- + multi-entity linking (leadId / campaignId / eventId)
ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "status"              "ActivityStatus",
  ADD COLUMN IF NOT EXISTS "planAlignment"       "FieldWorkPlanAlignment",
  ADD COLUMN IF NOT EXISTS "actualDate"          TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "outcomeSummary"      TEXT,
  ADD COLUMN IF NOT EXISTS "followUpRequired"    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "followUpDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "followUpDueDate"     TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "followUpAssigneeId"  TEXT,
  ADD COLUMN IF NOT EXISTS "leadId"              TEXT,
  ADD COLUMN IF NOT EXISTS "campaignId"          TEXT,
  ADD COLUMN IF NOT EXISTS "eventId"             TEXT;

-- AgentProfile: tierCalculatedAt (guard against manual writes) + lastMeetingDate
ALTER TABLE "agent_profiles"
  ADD COLUMN IF NOT EXISTS "tierCalculatedAt" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "lastMeetingDate"  TIMESTAMP;

-- ── 4. New tables (client_issues, account_interventions) ───────────────────

CREATE TABLE IF NOT EXISTS "client_issues" (
  "id"                 TEXT PRIMARY KEY,
  "institutionId"      TEXT NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
  "title"              TEXT NOT NULL,
  "description"        TEXT,
  "category"           "IssueCategory" NOT NULL,
  "severity"           "IssueSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status"             "IssueStatus"   NOT NULL DEFAULT 'OPEN',
  "ownerId"            TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "openedAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "targetResolutionAt" TIMESTAMP,
  "resolvedAt"         TIMESTAMP,
  "resolutionNotes"    TEXT,
  "createdAt"          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "client_issues_institutionId_status_idx"
  ON "client_issues"("institutionId", "status");
CREATE INDEX IF NOT EXISTS "client_issues_ownerId_status_idx"
  ON "client_issues"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "client_issues_severity_status_idx"
  ON "client_issues"("severity", "status");
CREATE INDEX IF NOT EXISTS "client_issues_targetResolutionAt_idx"
  ON "client_issues"("targetResolutionAt");

CREATE TABLE IF NOT EXISTS "account_interventions" (
  "id"               TEXT PRIMARY KEY,
  "institutionId"    TEXT NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
  "health"           "AccountHealth" NOT NULL,
  "reason"           TEXT NOT NULL,
  "correctiveAction" TEXT NOT NULL,
  "actionOwnerId"    TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewDate"       TIMESTAMP NOT NULL,
  "resolvedAt"       TIMESTAMP,
  "resolutionNotes"  TEXT,
  "createdAt"        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "account_interventions_institutionId_resolvedAt_idx"
  ON "account_interventions"("institutionId", "resolvedAt");
CREATE INDEX IF NOT EXISTS "account_interventions_reviewDate_idx"
  ON "account_interventions"("reviewDate");

-- ── 5. Foreign key constraints ─────────────────────────────────────────────
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS; wrap each in a DO block that
-- catches duplicate_object so re-runs are safe.

DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_originalSourceId_fkey"
    FOREIGN KEY ("originalSourceId") REFERENCES "sources"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_originalEventId_fkey"
    FOREIGN KEY ("originalEventId") REFERENCES "events"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "lead_documents" ADD CONSTRAINT "lead_documents_institutionInterestId_fkey"
    FOREIGN KEY ("institutionInterestId") REFERENCES "institution_interests"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "institutions" ADD CONSTRAINT "institutions_regionalManagerId_fkey"
    FOREIGN KEY ("regionalManagerId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "institution_contacts" ADD CONSTRAINT "institution_contacts_relationshipOwnerId_fkey"
    FOREIGN KEY ("relationshipOwnerId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supersededById_fkey"
    FOREIGN KEY ("supersededById") REFERENCES "contracts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "institution_documents" ADD CONSTRAINT "institution_documents_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "institution_documents" ADD CONSTRAINT "institution_documents_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "client_issues"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "institution_documents" ADD CONSTRAINT "institution_documents_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "activities" ADD CONSTRAINT "activities_followUpAssigneeId_fkey"
    FOREIGN KEY ("followUpAssigneeId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "activities" ADD CONSTRAINT "activities_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "activities" ADD CONSTRAINT "activities_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "activities" ADD CONSTRAINT "activities_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. Indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "leads_passportNumber_idx"    ON "leads"("passportNumber");
CREATE INDEX IF NOT EXISTS "leads_dateOfBirth_idx"       ON "leads"("dateOfBirth");
CREATE INDEX IF NOT EXISTS "leads_originalSourceId_idx"  ON "leads"("originalSourceId");
CREATE INDEX IF NOT EXISTS "leads_originalEventId_idx"   ON "leads"("originalEventId");

CREATE INDEX IF NOT EXISTS "lead_documents_institutionInterestId_idx"
  ON "lead_documents"("institutionInterestId");
CREATE INDEX IF NOT EXISTS "lead_documents_leadId_idx"
  ON "lead_documents"("leadId");

CREATE INDEX IF NOT EXISTS "institutions_regionalManagerId_idx"
  ON "institutions"("regionalManagerId");

CREATE INDEX IF NOT EXISTS "institution_users_userId_idx"
  ON "institution_users"("userId");
CREATE INDEX IF NOT EXISTS "institution_users_assignmentStatus_idx"
  ON "institution_users"("assignmentStatus");

CREATE INDEX IF NOT EXISTS "institution_contacts_institutionId_isActive_idx"
  ON "institution_contacts"("institutionId", "isActive");

CREATE INDEX IF NOT EXISTS "contracts_institutionId_statusEnum_idx"
  ON "contracts"("institutionId", "statusEnum");
CREATE INDEX IF NOT EXISTS "contracts_endDate_idx" ON "contracts"("endDate");

CREATE INDEX IF NOT EXISTS "institution_documents_institutionId_category_idx"
  ON "institution_documents"("institutionId", "category");

CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX IF NOT EXISTS "campaigns_name_city_country_startDate_idx"
  ON "campaigns"("name", "city", "country", "startDate");

CREATE INDEX IF NOT EXISTS "activities_status_idx"     ON "activities"("status");
CREATE INDEX IF NOT EXISTS "activities_leadId_idx"     ON "activities"("leadId");
CREATE INDEX IF NOT EXISTS "activities_campaignId_idx" ON "activities"("campaignId");
CREATE INDEX IF NOT EXISTS "activities_eventId_idx"    ON "activities"("eventId");

-- ── 7. Data backfills / remaps (safe, run last) ────────────────────────────

-- Pin the current sourceId/eventId as the original for every existing lead.
UPDATE "leads"
   SET "originalSourceId" = "sourceId"
 WHERE "originalSourceId" IS NULL
   AND "sourceId" IS NOT NULL;

UPDATE "leads"
   SET "originalEventId" = "eventId"
 WHERE "originalEventId" IS NULL
   AND "eventId" IS NOT NULL;

-- Best-effort firstTouchDate backfill.
UPDATE "leads"
   SET "firstTouchDate" = "createdAt"
 WHERE "firstTouchDate" IS NULL;

-- LeadApplication.depositStatus backfill from the boolean shape.
UPDATE "lead_applications"
   SET "depositStatus" = CASE
         WHEN "depositDeadlineNotApplicable" = true THEN 'NOT_REQUIRED'::"DepositStatus"
         WHEN "depositPaid" = true THEN 'PAID'::"DepositStatus"
         WHEN "depositPaid" = false AND "depositDeadline" IS NOT NULL
              THEN 'PENDING'::"DepositStatus"
         ELSE NULL
       END
 WHERE "depositStatus" IS NULL;

-- Contract.statusEnum backfill from free-text status.
UPDATE "contracts"
   SET "statusEnum" = CASE UPPER(COALESCE("status", 'ACTIVE'))
         WHEN 'DRAFT'            THEN 'DRAFT'::"ContractStatus"
         WHEN 'UNDER_REVIEW'     THEN 'UNDER_REVIEW'::"ContractStatus"
         WHEN 'PENDING'          THEN 'UNDER_REVIEW'::"ContractStatus"
         WHEN 'ACTIVE'           THEN 'ACTIVE'::"ContractStatus"
         WHEN 'RENEWAL_PENDING'  THEN 'RENEWAL_PENDING'::"ContractStatus"
         WHEN 'RENEWAL PENDING'  THEN 'RENEWAL_PENDING'::"ContractStatus"
         WHEN 'EXPIRED'          THEN 'EXPIRED'::"ContractStatus"
         WHEN 'TERMINATED'       THEN 'TERMINATED'::"ContractStatus"
         WHEN 'CANCELLED'        THEN 'TERMINATED'::"ContractStatus"
         WHEN 'SUPERSEDED'       THEN 'SUPERSEDED'::"ContractStatus"
         ELSE 'ACTIVE'::"ContractStatus"
       END
 WHERE "statusEnum" IS NULL;

-- InstitutionDocument.category backfill from free-text type.
UPDATE "institution_documents"
   SET "category" = CASE UPPER(COALESCE("type", 'OTHER'))
         WHEN 'CONTRACT'          THEN 'CONTRACTS'::"DocumentCategory"
         WHEN 'CONTRACTS'         THEN 'CONTRACTS'::"DocumentCategory"
         WHEN 'PROPOSAL'          THEN 'PROPOSALS'::"DocumentCategory"
         WHEN 'PROPOSALS'         THEN 'PROPOSALS'::"DocumentCategory"
         WHEN 'REPORT'            THEN 'REPORTS'::"DocumentCategory"
         WHEN 'REPORTS'           THEN 'REPORTS'::"DocumentCategory"
         WHEN 'MEETING_MINUTES'   THEN 'MEETING_MINUTES'::"DocumentCategory"
         WHEN 'MINUTES'           THEN 'MEETING_MINUTES'::"DocumentCategory"
         WHEN 'MARKETING'         THEN 'MARKETING_MATERIALS'::"DocumentCategory"
         WHEN 'BRAND'             THEN 'BRAND_ASSETS'::"DocumentCategory"
         WHEN 'ACTIVITY_EVIDENCE' THEN 'ACTIVITY_EVIDENCE'::"DocumentCategory"
         WHEN 'FINANCIAL'         THEN 'FINANCIAL_DOCUMENTS'::"DocumentCategory"
         WHEN 'COMPLIANCE'        THEN 'COMPLIANCE_DOCUMENTS'::"DocumentCategory"
         WHEN 'PRESENTATION'      THEN 'PRESENTATIONS'::"DocumentCategory"
         WHEN 'PRESENTATIONS'     THEN 'PRESENTATIONS'::"DocumentCategory"
         ELSE 'OTHER'::"DocumentCategory"
       END
 WHERE "category" IS NULL;

-- Campaign.status backfill from isActive + dates.
UPDATE "campaigns"
   SET "status" = CASE
         WHEN "isActive" = false AND "endDate" IS NOT NULL AND "endDate" < CURRENT_TIMESTAMP
           THEN 'CLOSED'::"CampaignStatus"
         WHEN "isActive" = false
           THEN 'CANCELLED'::"CampaignStatus"
         WHEN "isActive" = true AND "startDate" > CURRENT_TIMESTAMP
           THEN 'PLANNED'::"CampaignStatus"
         WHEN "isActive" = true AND "endDate" IS NOT NULL AND "endDate" < CURRENT_TIMESTAMP
           THEN 'COMPLETED'::"CampaignStatus"
         ELSE 'OPEN'::"CampaignStatus"
       END
 WHERE "status" IS NULL;

-- Activity.status backfill.
UPDATE "activities"
   SET "status" = CASE
         WHEN "endDate" IS NOT NULL AND "endDate" < CURRENT_TIMESTAMP
           THEN 'COMPLETED'::"ActivityStatus"
         WHEN "date" > CURRENT_TIMESTAMP
           THEN 'PLANNED'::"ActivityStatus"
         ELSE 'IN_PROGRESS'::"ActivityStatus"
       END
 WHERE "status" IS NULL;

-- Activity.actualDate for completed rows.
UPDATE "activities"
   SET "actualDate" = "endDate"
 WHERE "actualDate" IS NULL
   AND "endDate" IS NOT NULL
   AND "status" = 'COMPLETED'::"ActivityStatus";

-- Remaps:
-- ApplicationSubmissionMethod: split ONLINE_PORTAL / AGENT
UPDATE "lead_applications"
   SET "submissionMethod" = 'UNIVERSITY_PORTAL'::"ApplicationSubmissionMethod"
 WHERE "submissionMethod" = 'ONLINE_PORTAL'::"ApplicationSubmissionMethod";

UPDATE "lead_applications"
   SET "submissionMethod" = 'AGENT_PORTAL'::"ApplicationSubmissionMethod"
 WHERE "submissionMethod" = 'AGENT'::"ApplicationSubmissionMethod";

-- RelationshipStatus: legacy NEW/ESTABLISHED/STRATEGIC → ACTIVE
UPDATE "schools"
   SET "relationshipStatus" = 'ACTIVE'::"RelationshipStatus"
 WHERE "relationshipStatus" IN (
   'NEW'::"RelationshipStatus",
   'ESTABLISHED'::"RelationshipStatus",
   'STRATEGIC'::"RelationshipStatus"
 );

-- ActivityType: STUDENT_EVENT → EVENT_FOLLOW_UP, FAIR → EVENT_PREPARATION
UPDATE "activities"
   SET "type" = 'EVENT_FOLLOW_UP'::"ActivityType"
 WHERE "type" = 'STUDENT_EVENT'::"ActivityType";

UPDATE "activities"
   SET "type" = 'EVENT_PREPARATION'::"ActivityType"
 WHERE "type" = 'FAIR'::"ActivityType";

-- AccountStatus: legacy RENEWAL_DUE → ACTIVE, CHURNED → CLOSED
UPDATE "institutions"
   SET "accountStatus" = 'ACTIVE'::"AccountStatus"
 WHERE "accountStatus" = 'RENEWAL_DUE'::"AccountStatus";

UPDATE "institutions"
   SET "accountStatus" = 'CLOSED'::"AccountStatus"
 WHERE "accountStatus" = 'CHURNED'::"AccountStatus";

-- ── 8. Audit log ───────────────────────────────────────────────────────────

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(),
  NULL,
  'MIGRATION_019_SPEC_GAP_CLOSURE',
  'SCHEMA',
  '019',
  jsonb_build_object(
    'enumsAdded', ARRAY[
      'CounsellingOutcome', 'EnrolmentStatus', 'DepositStatus', 'LeadChannel',
      'AccountHealth', 'IssueCategory', 'IssueSeverity', 'IssueStatus',
      'ServiceScope', 'ReportingFrequency', 'ContactCategory',
      'ContractStatus', 'ContractType', 'DocumentCategory',
      'AccountRole', 'AssignmentStatus', 'CampaignStatus', 'ActivityStatus'
    ],
    'tablesAdded', ARRAY['client_issues', 'account_interventions'],
    'rolesAdded', ARRAY['ACCOUNT_MANAGER', 'ADMISSIONS_SUPPORT', 'VP_GLOBAL_SALES'],
    'remaps', jsonb_build_object(
      'submissionMethod',    'ONLINE_PORTAL→UNIVERSITY_PORTAL, AGENT→AGENT_PORTAL',
      'activityType',        'STUDENT_EVENT→EVENT_FOLLOW_UP, FAIR→EVENT_PREPARATION',
      'accountStatus',       'RENEWAL_DUE→ACTIVE, CHURNED→CLOSED',
      'relationshipStatus',  'NEW/ESTABLISHED/STRATEGIC→ACTIVE'
    )
  ),
  CURRENT_TIMESTAMP
);
