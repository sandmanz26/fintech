-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ANALYST', 'SENIOR_ANALYST', 'RISK_MANAGER', 'COMPLIANCE', 'AUDITOR', 'ADMIN', 'MERCHANT');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('APPLICATION_DRAFT', 'SUBMITTED', 'IN_UNDERWRITING', 'PENDING_INFO', 'APPROVED', 'DECLINED', 'ACTIVE', 'UNDER_REVIEW', 'RESTRICTED', 'TERMINATION_PENDING', 'TERMINATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiskBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'PROHIBITED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'ASSIGNED', 'IN_REVIEW', 'AWAITING_MERCHANT', 'PENDING_APPROVAL', 'RESOLVED', 'REOPENED');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('UNDERWRITING', 'MONITORING', 'DISPUTE_SPIKE', 'WATCHLIST', 'RFI_FOLLOWUP', 'OFFBOARDING');

-- CreateEnum
CREATE TYPE "ControlType" AS ENUM ('VOLUME_LIMIT_DAILY', 'VOLUME_LIMIT_MONTHLY', 'MAX_TICKET', 'ROLLING_RESERVE', 'FIXED_RESERVE', 'UPFRONT_RESERVE', 'PAYOUT_DELAY', 'PAYOUT_HOLD');

-- CreateEnum
CREATE TYPE "ControlStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'EXPIRED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryModel" AS ENUM ('IMMEDIATE', 'DIGITAL', 'SHIPPED', 'FUTURE_SERVICE', 'SUBSCRIPTION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "merchantId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "dbaName" TEXT,
    "registrationNo" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "mcc" TEXT NOT NULL,
    "website" TEXT,
    "incorporatedAt" TIMESTAMP(3),
    "deliveryModel" "DeliveryModel" NOT NULL,
    "avgDeliveryDays" INTEGER NOT NULL DEFAULT 0,
    "expectedMonthlyVolumeMinor" BIGINT NOT NULL,
    "expectedAvgTicketMinor" BIGINT NOT NULL,
    "priorCbRatioBps" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "MerchantStatus" NOT NULL DEFAULT 'APPLICATION_DRAFT',
    "currentBand" "RiskBand",
    "currentScore" INTEGER,
    "assignedToId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "idNumber" TEXT,
    "ownershipPct" DECIMAL(5,2) NOT NULL,
    "isController" BOOLEAN NOT NULL DEFAULT false,
    "parentOwnerId" TEXT,
    "screeningStatus" TEXT NOT NULL DEFAULT 'NOT_SCREENED',

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decision" TEXT,
    "decisionReasonCode" TEXT,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "checklist" JSONB NOT NULL,
    "checks" JSONB,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "rfiId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "expiresAt" TIMESTAMP(3),
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "RiskBand" NOT NULL,
    "factors" JSONB NOT NULL,
    "hardStops" JSONB NOT NULL,
    "trigger" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cardCountry" TEXT NOT NULL,
    "cardBin" TEXT NOT NULL,
    "isCrossBorder" BOOLEAN NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMerchantMetric" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "grossVolumeMinor" BIGINT NOT NULL,
    "settledCount" INTEGER NOT NULL,
    "authAttempts" INTEGER NOT NULL,
    "declineCount" INTEGER NOT NULL,
    "refundCount" INTEGER NOT NULL,
    "refundVolumeMinor" BIGINT NOT NULL,
    "chargebackCount" INTEGER NOT NULL,
    "chargebackVolumeMinor" BIGINT NOT NULL,
    "avgTicketMinor" BIGINT NOT NULL,
    "crossBorderPct" DECIMAL(5,2) NOT NULL,
    "smallAuthCount" INTEGER NOT NULL,

    CONSTRAINT "DailyMerchantMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reasonCategory" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleVersion" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeNote" TEXT NOT NULL,

    CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dismissReasonCode" TEXT,
    "dismissNote" TEXT,
    "evidence" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "caseId" TEXT,
    "metricDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" "CaseType" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Severity" NOT NULL,
    "title" TEXT,
    "assigneeId" TEXT,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "slaBreachedAt" TIMESTAMP(3),
    "resolutionCode" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Control" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" "ControlType" NOT NULL,
    "params" JSONB NOT NULL,
    "status" "ControlStatus" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reviewAt" TIMESTAMP(3) NOT NULL,
    "reviewCaseId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvalId" TEXT,
    "caseId" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveLedgerEntry" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "sourceDate" DATE NOT NULL,
    "releaseAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReserveLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "merchantId" TEXT,
    "caseId" TEXT,
    "summary" TEXT,
    "requestedById" TEXT NOT NULL,
    "approverRole" "Role" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfi" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "messageToMerchant" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistHit" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "listName" TEXT NOT NULL,
    "matchedName" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminatedListEntry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNo" TEXT,
    "reasonCode" TEXT NOT NULL,
    "merchantId" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerminatedListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReasonCode" (
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "merchantFacingText" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReasonCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "changeNote" TEXT NOT NULL DEFAULT '',
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimClock" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "today" DATE NOT NULL,

    CONSTRAINT "SimClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" "Role",
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "items" INTEGER,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "meta" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Merchant_status_currentBand_idx" ON "Merchant"("status", "currentBand");

-- CreateIndex
CREATE INDEX "RiskAssessment_merchantId_createdAt_idx" ON "RiskAssessment"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_merchantId_occurredAt_idx" ON "Transaction"("merchantId", "occurredAt");

-- CreateIndex
CREATE INDEX "DailyMerchantMetric_date_idx" ON "DailyMerchantMetric"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMerchantMetric_merchantId_date_key" ON "DailyMerchantMetric"("merchantId", "date");

-- CreateIndex
CREATE INDEX "Dispute_merchantId_receivedAt_idx" ON "Dispute"("merchantId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_key_key" ON "Rule"("key");

-- CreateIndex
CREATE UNIQUE INDEX "RuleVersion_ruleId_version_key" ON "RuleVersion"("ruleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "Alert_status_severity_idx" ON "Alert"("status", "severity");

-- CreateIndex
CREATE INDEX "Alert_merchantId_ruleKey_idx" ON "Alert"("merchantId", "ruleKey");

-- CreateIndex
CREATE INDEX "Case_status_priority_slaDueAt_idx" ON "Case"("status", "priority", "slaDueAt");

-- CreateIndex
CREATE INDEX "Case_merchantId_type_status_idx" ON "Case"("merchantId", "type", "status");

-- CreateIndex
CREATE INDEX "CaseEvent_caseId_createdAt_idx" ON "CaseEvent"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "Control_merchantId_status_idx" ON "Control"("merchantId", "status");

-- CreateIndex
CREATE INDEX "ReserveLedgerEntry_merchantId_releaseAt_idx" ON "ReserveLedgerEntry"("merchantId", "releaseAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReserveLedgerEntry_controlId_direction_sourceDate_key" ON "ReserveLedgerEntry"("controlId", "direction", "sourceDate");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_approverRole_idx" ON "ApprovalRequest"("status", "approverRole");

-- CreateIndex
CREATE UNIQUE INDEX "Rfi_token_key" ON "Rfi"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_version_key" ON "Policy"("version");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_idx" ON "AuditLog"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "JobRun_name_startedAt_idx" ON "JobRun"("name", "startedAt");

-- AddForeignKey
ALTER TABLE "Owner" ADD CONSTRAINT "Owner_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMerchantMetric" ADD CONSTRAINT "DailyMerchantMetric_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleVersion" ADD CONSTRAINT "RuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Control" ADD CONSTRAINT "Control_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveLedgerEntry" ADD CONSTRAINT "ReserveLedgerEntry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistHit" ADD CONSTRAINT "WatchlistHit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
