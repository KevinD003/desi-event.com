-- Phase 2: commerce and organiser operations.
--
-- Additive for every Phase 1 table. The one destructive change is removing
-- `ADMIN` from `UserRole`, which is migrated to `SUPER_ADMIN` during the cast
-- below so no row is left holding a value the type no longer has.
--
-- After the generated schema changes, this migration does four things a schema
-- diff cannot express:
--
--   1. Backfills. An organisation's verification status is derived from the
--      Phase 1 `verified` boolean; venues get deterministic slugs.
--   2. CHECK constraints for invariants the application must not be trusted
--      with alone — an over-refund, a negative ledger amount, a seat held with
--      no hold.
--   3. Triggers that make a posted ledger batch balanced and immutable. These
--      are the reason a report and the money cannot quietly disagree, and they
--      are in the database because a service-layer promise is one bad code path
--      away from being broken.
--   4. The chart of accounts, which is structure rather than sample data and so
--      belongs in the migration rather than the seed.

-- CreateEnum
CREATE TYPE "WebhookState" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "MfaFactorType" AS ENUM ('TOTP', 'RECOVERY_CODE', 'WEBAUTHN');

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'TICKET_CLAIM', 'TICKET_TRANSFER', 'CONNECT_ONBOARDING');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'REQUIRES_INFORMATION', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SectionKind" AS ENUM ('SEATED', 'STANDING', 'TABLE');

-- CreateEnum
CREATE TYPE "EventSessionStatus" AS ENUM ('SCHEDULED', 'ON_SALE', 'SALES_PAUSED', 'SOLD_OUT', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EventSeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'SOLD', 'BLOCKED', 'COMPLIMENTARY', 'KILLED');

-- CreateEnum
CREATE TYPE "MediaModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MediaScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ConnectOnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'REQUIREMENTS_DUE', 'COMPLETE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('EVENT_CANCELLED', 'EVENT_POSTPONED', 'DUPLICATE_ORDER', 'CUSTOMER_REQUEST', 'ORGANIZER_GOODWILL', 'FRAUDULENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('NEEDS_RESPONSE', 'UNDER_REVIEW', 'CHARGE_REFUNDED', 'WON', 'LOST', 'WARNING_NEEDS_RESPONSE', 'WARNING_CLOSED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'SENT', 'PAID', 'FAILED', 'REVERSED', 'PARTIALLY_REVERSED', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'CONTRA_REVENUE');

-- CreateEnum
CREATE TYPE "LedgerBatchStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "LedgerBatchKind" AS ENUM ('ORDER_PAID', 'REFUND', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'TRANSFER', 'TRANSFER_REVERSAL', 'PAYOUT', 'PLATFORM_FEE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TicketTransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('QR_SCAN', 'MANUAL_LOOKUP', 'ASSISTED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'DEAD_LETTER', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "ReconciliationState" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ReconciliationKind" AS ENUM ('PAYMENT_TIMEOUT', 'PROVIDER_MISMATCH', 'REFUND_UNKNOWN', 'WEBHOOK_DEAD_LETTER', 'TRANSFER_STUCK');

-- AlterEnum
--
-- The generator emits an explicit BEGIN/COMMIT pair around this block. Left in
-- place it is actively harmful: Prisma already runs the whole migration file in
-- one transaction, so the inner COMMIT ends it early and every statement after
-- this point runs auto-committed. A failure halfway down then leaves the
-- database in a state the migration cannot be retried from — which is exactly
-- what happened while this migration was being written, and it took a rebuilt
-- database to recover. The pair is removed so the file is atomic: it either
-- applies completely or leaves nothing behind.
--
-- Nothing here needs its own transaction. PostgreSQL 12 and later accept
-- `ALTER TYPE ... ADD VALUE` inside a transaction, and no statement in this
-- migration uses a value it has just added.
CREATE TYPE "UserRole_new" AS ENUM ('ATTENDEE', 'ORGANIZER', 'SUPPORT', 'MODERATOR', 'FINANCE_ADMIN', 'SUPER_ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
-- Phase 1's single catch-all ADMIN becomes SUPER_ADMIN. Mapped during the cast
-- rather than in a separate UPDATE, because the old value stops existing the
-- moment the type is replaced and a two-step version would fail in between.
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING (
  CASE "role"::text WHEN 'ADMIN' THEN 'SUPER_ADMIN' ELSE "role"::text END
)::"UserRole_new";
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'ATTENDEE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrgRole" ADD VALUE 'EVENT_MANAGER';
ALTER TYPE "OrgRole" ADD VALUE 'FINANCE';
ALTER TYPE "OrgRole" ADD VALUE 'SCANNER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventStatus" ADD VALUE 'REVIEW_PENDING';
ALTER TYPE "EventStatus" ADD VALUE 'CHANGES_REQUIRED';
ALTER TYPE "EventStatus" ADD VALUE 'APPROVED';
ALTER TYPE "EventStatus" ADD VALUE 'ON_SALE';
ALTER TYPE "EventStatus" ADD VALUE 'SALES_PAUSED';
ALTER TYPE "EventStatus" ADD VALUE 'SOLD_OUT';
ALTER TYPE "EventStatus" ADD VALUE 'POSTPONED';
ALTER TYPE "EventStatus" ADD VALUE 'REJECTED';
ALTER TYPE "EventStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketStatus" ADD VALUE 'TRANSFERRED';
ALTER TYPE "TicketStatus" ADD VALUE 'SUPERSEDED';
ALTER TYPE "TicketStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'REQUIRES_ACTION';
ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- DropIndex
DROP INDEX "WebhookEvent_provider_providerEventId_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "refundPolicy" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verificationUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "invitationId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows have taken the default; the column's shape now matches what
-- `@updatedAt` expects, which is NOT NULL with no default.
ALTER TABLE "Membership" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "accessibility" JSONB,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "directions" TEXT,
ADD COLUMN     "mergedIntoVenueId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "policies" TEXT,
ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "accessibility" JSONB,
ADD COLUMN     "ageRestriction" INTEGER,
ADD COLUMN     "artists" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "moderationNote" TEXT,
ADD COLUMN     "policies" JSONB,
ADD COLUMN     "postponedAt" TIMESTAMP(3),
ADD COLUMN     "previousStartsAt" TIMESTAMP(3),
ADD COLUMN     "reviewSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "salesOpenedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TicketType" ADD COLUMN     "complimentary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eventSessionId" TEXT,
ADD COLUMN     "priceZoneId" TEXT,
ADD COLUMN     "reserved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TicketHold" ADD COLUMN     "eventSessionId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "eventSessionId" TEXT,
ADD COLUMN     "policySnapshot" JSONB,
ADD COLUMN     "refundPendingCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "refundedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "credentialHash" TEXT,
ADD COLUMN     "credentialIssuedAt" TIMESTAMP(3),
ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "eventSeatId" TEXT,
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedReason" TEXT,
ADD COLUMN     "supersedesTicketId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "clientSecretIssuedAt" TIMESTAMP(3),
ADD COLUMN     "methodBrand" TEXT,
ADD COLUMN     "methodExpMonth" INTEGER,
ADD COLUMN     "methodExpYear" INTEGER,
ADD COLUMN     "methodLast4" TEXT,
ADD COLUMN     "methodType" TEXT,
ADD COLUMN     "pricingPolicyVersion" TEXT,
ADD COLUMN     "providerAccountId" TEXT;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "accountContext" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "apiVersion" TEXT,
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "providerCreatedAt" TIMESTAMP(3),
ADD COLUMN     "state" "WebhookState" NOT NULL DEFAULT 'RECEIVED';

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "mfaSatisfiedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "fingerprintHash" TEXT NOT NULL,
    "trustedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MfaFactorType" NOT NULL,
    "label" TEXT,
    "secretSealed" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "subjectId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerScope" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScannerScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationVerificationEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromStatus" "VerificationStatus",
    "toStatus" "VerificationStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationVerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueMap" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueMapVersion" (
    "id" TEXT NOT NULL,
    "venueMapId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "seatCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueMapVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "venueMapVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SectionKind" NOT NULL DEFAULT 'SEATED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "standingCapacity" INTEGER,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatRow" (
    "id" TEXT NOT NULL,
    "venueMapVersionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SeatRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceZone" (
    "id" TEXT NOT NULL,
    "venueMapVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colourToken" TEXT NOT NULL DEFAULT 'zone-default',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PriceZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" TEXT NOT NULL,
    "venueMapVersionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "rowId" TEXT,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "priceZoneId" TEXT,
    "accessible" BOOLEAN NOT NULL DEFAULT false,
    "companionOfSeatId" TEXT,
    "obstructedView" BOOLEAN NOT NULL DEFAULT false,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "restrictionNote" TEXT,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSession" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "doorsOpenAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "salesStartAt" TIMESTAMP(3),
    "salesEndAt" TIMESTAMP(3),
    "status" "EventSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "venueMapVersionId" TEXT,
    "capacity" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSeat" (
    "id" TEXT NOT NULL,
    "eventSessionId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "ticketTypeId" TEXT,
    "status" "EventSeatStatus" NOT NULL DEFAULT 'AVAILABLE',
    "holdId" TEXT,
    "orderItemId" TEXT,
    "priceCentsOverride" INTEGER,
    "blockedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoldItem" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "eventSeatId" TEXT,

    CONSTRAINT "HoldItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventModerationAction" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" "EventStatus",
    "toStatus" "EventStatus" NOT NULL,
    "reason" TEXT,
    "requestedChanges" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "eventId" TEXT,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "sanitisedAt" TIMESTAMP(3),
    "moderationStatus" "MediaModerationStatus" NOT NULL DEFAULT 'PENDING',
    "scanStatus" "MediaScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanNote" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerMode" TEXT NOT NULL DEFAULT 'test',
    "country" TEXT,
    "defaultCurrency" TEXT,
    "onboardingStatus" "ConnectOnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "disabledReason" TEXT,
    "requirementsDue" JSONB,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" "RefundReason" NOT NULL DEFAULT 'CUSTOMER_REQUEST',
    "reasonNote" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "allocation" JSONB,
    "platformFeeRefundedCents" INTEGER NOT NULL DEFAULT 0,
    "transferReversedCents" INTEGER NOT NULL DEFAULT 0,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "ticketsRevoked" BOOLEAN NOT NULL DEFAULT false,
    "inventoryReturned" BOOLEAN NOT NULL DEFAULT false,
    "failureCode" TEXT,
    "rawProviderStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundItem" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "ticketId" TEXT,

    CONSTRAINT "RefundItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerDisputeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'NEEDS_RESPONSE',
    "evidenceDueAt" TIMESTAMP(3),
    "rawProviderStatus" TEXT,
    "fundsWithheld" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectedAccountId" TEXT,
    "orderId" TEXT,
    "provider" TEXT NOT NULL,
    "providerTransferId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "reversedCents" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "failureCode" TEXT,
    "rawProviderStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectedAccountId" TEXT,
    "provider" TEXT NOT NULL,
    "providerPayoutId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "arrivalDate" TIMESTAMP(3),
    "failureCode" TEXT,
    "rawProviderStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerBatch" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "LedgerBatchKind" NOT NULL,
    "status" "LedgerBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "refundId" TEXT,
    "disputeId" TEXT,
    "transferId" TEXT,
    "payoutId" TEXT,
    "compensatesBatchId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "LedgerBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "memo" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTransfer" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toEmail" TEXT NOT NULL,
    "toUserId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "TicketTransferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "resultTicketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "eventSessionId" TEXT,
    "scannedByUserId" TEXT,
    "deviceId" TEXT,
    "method" "CheckInMethod" NOT NULL DEFAULT 'QR_SCAN',
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gate" TEXT,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "recipient" TEXT NOT NULL,
    "userId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "suppressible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationTask" (
    "id" TEXT NOT NULL,
    "kind" "ReconciliationKind" NOT NULL,
    "state" "ReconciliationState" NOT NULL DEFAULT 'OPEN',
    "paymentId" TEXT,
    "orderId" TEXT,
    "refundId" TEXT,
    "webhookEventId" TEXT,
    "providerRef" TEXT,
    "localState" JSONB,
    "providerState" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "assignedToId" TEXT,
    "resolution" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_deviceId_idx" ON "Session"("deviceId");

-- CreateIndex
CREATE INDEX "Device_userId_revokedAt_idx" ON "Device"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_fingerprintHash_key" ON "Device"("userId", "fingerprintHash");

-- CreateIndex
CREATE INDEX "MfaFactor_userId_type_confirmedAt_idx" ON "MfaFactor"("userId", "type", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MfaFactor_userId_type_secretSealed_key" ON "MfaFactor"("userId", "type", "secretSealed");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_usedAt_idx" ON "AuthToken"("userId", "purpose", "usedAt");

-- CreateIndex
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthToken_purpose_subjectId_idx" ON "AuthToken"("purpose", "subjectId");

-- CreateIndex
CREATE INDEX "LoginAttempt_emailHash_createdAt_idx" ON "LoginAttempt"("emailHash", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ipHash_createdAt_idx" ON "LoginAttempt"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "ScannerScope_eventId_idx" ON "ScannerScope"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ScannerScope_membershipId_eventId_key" ON "ScannerScope"("membershipId", "eventId");

-- CreateIndex
CREATE INDEX "OrganizationVerificationEvent_organizationId_createdAt_idx" ON "OrganizationVerificationEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_status_idx" ON "Invitation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Invitation_email_status_idx" ON "Invitation"("email", "status");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VenueMap_venueId_name_key" ON "VenueMap"("venueId", "name");

-- CreateIndex
CREATE INDEX "VenueMapVersion_publishedAt_idx" ON "VenueMapVersion"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VenueMapVersion_venueMapId_version_key" ON "VenueMapVersion"("venueMapId", "version");

-- CreateIndex
CREATE INDEX "Section_venueMapVersionId_sortOrder_idx" ON "Section"("venueMapVersionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Section_venueMapVersionId_name_key" ON "Section"("venueMapVersionId", "name");

-- CreateIndex
CREATE INDEX "SeatRow_venueMapVersionId_idx" ON "SeatRow"("venueMapVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatRow_sectionId_label_key" ON "SeatRow"("sectionId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "PriceZone_venueMapVersionId_name_key" ON "PriceZone"("venueMapVersionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_companionOfSeatId_key" ON "Seat"("companionOfSeatId");

-- CreateIndex
CREATE INDEX "Seat_sectionId_sortOrder_idx" ON "Seat"("sectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "Seat_rowId_sortOrder_idx" ON "Seat"("rowId", "sortOrder");

-- CreateIndex
CREATE INDEX "Seat_priceZoneId_idx" ON "Seat"("priceZoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_venueMapVersionId_label_key" ON "Seat"("venueMapVersionId", "label");

-- CreateIndex
CREATE INDEX "EventSession_eventId_startsAt_idx" ON "EventSession"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "EventSession_status_startsAt_idx" ON "EventSession"("status", "startsAt");

-- CreateIndex
CREATE INDEX "EventSession_venueMapVersionId_idx" ON "EventSession"("venueMapVersionId");

-- CreateIndex
CREATE INDEX "EventSeat_eventSessionId_status_idx" ON "EventSeat"("eventSessionId", "status");

-- CreateIndex
CREATE INDEX "EventSeat_holdId_idx" ON "EventSeat"("holdId");

-- CreateIndex
CREATE INDEX "EventSeat_orderItemId_idx" ON "EventSeat"("orderItemId");

-- CreateIndex
CREATE INDEX "EventSeat_ticketTypeId_status_idx" ON "EventSeat"("ticketTypeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventSeat_eventSessionId_seatId_key" ON "EventSeat"("eventSessionId", "seatId");

-- CreateIndex
CREATE INDEX "HoldItem_holdId_idx" ON "HoldItem"("holdId");

-- CreateIndex
CREATE INDEX "HoldItem_eventSeatId_idx" ON "HoldItem"("eventSeatId");

-- CreateIndex
CREATE UNIQUE INDEX "HoldItem_holdId_eventSeatId_key" ON "HoldItem"("holdId", "eventSeatId");

-- CreateIndex
CREATE INDEX "EventModerationAction_eventId_createdAt_idx" ON "EventModerationAction"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "EventModerationAction_actorId_idx" ON "EventModerationAction"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MediaAsset_ownerType_ownerId_idx" ON "MediaAsset"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "MediaAsset_moderationStatus_scanStatus_idx" ON "MediaAsset"("moderationStatus", "scanStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_organizationId_key" ON "ConnectedAccount"("organizationId");

-- CreateIndex
CREATE INDEX "ConnectedAccount_onboardingStatus_idx" ON "ConnectedAccount"("onboardingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_provider_providerAccountId_key" ON "ConnectedAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Refund_orderId_status_idx" ON "Refund"("orderId", "status");

-- CreateIndex
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_provider_providerRefundId_key" ON "Refund"("provider", "providerRefundId");

-- CreateIndex
CREATE INDEX "RefundItem_refundId_idx" ON "RefundItem"("refundId");

-- CreateIndex
CREATE INDEX "RefundItem_orderItemId_idx" ON "RefundItem"("orderItemId");

-- CreateIndex
CREATE INDEX "Dispute_status_evidenceDueAt_idx" ON "Dispute"("status", "evidenceDueAt");

-- CreateIndex
CREATE INDEX "Dispute_paymentId_idx" ON "Dispute"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_provider_providerDisputeId_key" ON "Dispute"("provider", "providerDisputeId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_idempotencyKey_key" ON "Transfer"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transfer_organizationId_status_idx" ON "Transfer"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Transfer_orderId_idx" ON "Transfer"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_provider_providerTransferId_key" ON "Transfer"("provider", "providerTransferId");

-- CreateIndex
CREATE INDEX "Payout_organizationId_status_idx" ON "Payout"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_provider_providerPayoutId_key" ON "Payout"("provider", "providerPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE INDEX "LedgerAccount_type_active_idx" ON "LedgerAccount"("type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerBatch_reference_key" ON "LedgerBatch"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerBatch_idempotencyKey_key" ON "LedgerBatch"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerBatch_compensatesBatchId_key" ON "LedgerBatch"("compensatesBatchId");

-- CreateIndex
CREATE INDEX "LedgerBatch_status_postedAt_idx" ON "LedgerBatch"("status", "postedAt");

-- CreateIndex
CREATE INDEX "LedgerBatch_sourceType_sourceId_idx" ON "LedgerBatch"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "LedgerBatch_orderId_idx" ON "LedgerBatch"("orderId");

-- CreateIndex
CREATE INDEX "LedgerBatch_kind_postedAt_idx" ON "LedgerBatch"("kind", "postedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_batchId_idx" ON "LedgerEntry"("batchId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_organizationId_createdAt_idx" ON "LedgerEntry"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTransfer_tokenHash_key" ON "TicketTransfer"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTransfer_resultTicketId_key" ON "TicketTransfer"("resultTicketId");

-- CreateIndex
CREATE INDEX "TicketTransfer_ticketId_status_idx" ON "TicketTransfer"("ticketId", "status");

-- CreateIndex
CREATE INDEX "TicketTransfer_toEmail_status_idx" ON "TicketTransfer"("toEmail", "status");

-- CreateIndex
CREATE INDEX "TicketTransfer_expiresAt_idx" ON "TicketTransfer"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_ticketId_key" ON "CheckIn"("ticketId");

-- CreateIndex
CREATE INDEX "CheckIn_eventSessionId_scannedAt_idx" ON "CheckIn"("eventSessionId", "scannedAt");

-- CreateIndex
CREATE INDEX "CheckIn_scannedByUserId_idx" ON "CheckIn"("scannedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key" ON "NotificationOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_scheduledFor_idx" ON "NotificationOutbox"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "NotificationOutbox_userId_idx" ON "NotificationOutbox"("userId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_template_idx" ON "NotificationOutbox"("template");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_category_channel_key" ON "NotificationPreference"("userId", "category", "channel");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");

-- CreateIndex
CREATE INDEX "ReconciliationTask_state_kind_createdAt_idx" ON "ReconciliationTask"("state", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationTask_paymentId_idx" ON "ReconciliationTask"("paymentId");

-- CreateIndex
CREATE INDEX "ReconciliationTask_providerRef_idx" ON "ReconciliationTask"("providerRef");

-- CreateIndex
CREATE INDEX "User_suspendedAt_idx" ON "User"("suspendedAt");

-- CreateIndex
CREATE INDEX "Organization_verificationStatus_idx" ON "Organization"("verificationStatus");

-- CreateIndex
CREATE INDEX "Organization_suspendedAt_idx" ON "Organization"("suspendedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_invitationId_key" ON "Membership"("invitationId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_slug_key" ON "Venue"("slug");

-- CreateIndex
CREATE INDEX "Venue_organizationId_idx" ON "Venue"("organizationId");

-- CreateIndex
CREATE INDEX "Venue_mergedIntoVenueId_idx" ON "Venue"("mergedIntoVenueId");

-- CreateIndex
CREATE INDEX "TicketType_eventSessionId_idx" ON "TicketType"("eventSessionId");

-- CreateIndex
CREATE INDEX "TicketType_priceZoneId_idx" ON "TicketType"("priceZoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_credentialHash_key" ON "Ticket"("credentialHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_eventSeatId_key" ON "Ticket"("eventSeatId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_supersedesTicketId_key" ON "Ticket"("supersedesTicketId");

-- CreateIndex
CREATE INDEX "Ticket_ownerUserId_idx" ON "Ticket"("ownerUserId");

-- CreateIndex
CREATE INDEX "Payment_providerAccountId_idx" ON "Payment"("providerAccountId");

-- CreateIndex
CREATE INDEX "WebhookEvent_state_nextAttemptAt_idx" ON "WebhookEvent"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_eventType_idx" ON "WebhookEvent"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_accountContext_providerEventId_key" ON "WebhookEvent"("provider", "accountContext", "providerEventId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_mergedIntoVenueId_fkey" FOREIGN KEY ("mergedIntoVenueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_priceZoneId_fkey" FOREIGN KEY ("priceZoneId") REFERENCES "PriceZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketHold" ADD CONSTRAINT "TicketHold_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_eventSeatId_fkey" FOREIGN KEY ("eventSeatId") REFERENCES "EventSeat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_supersedesTicketId_fkey" FOREIGN KEY ("supersedesTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaFactor" ADD CONSTRAINT "MfaFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerScope" ADD CONSTRAINT "ScannerScope_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationVerificationEvent" ADD CONSTRAINT "OrganizationVerificationEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueMap" ADD CONSTRAINT "VenueMap_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueMapVersion" ADD CONSTRAINT "VenueMapVersion_venueMapId_fkey" FOREIGN KEY ("venueMapId") REFERENCES "VenueMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_venueMapVersionId_fkey" FOREIGN KEY ("venueMapVersionId") REFERENCES "VenueMapVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatRow" ADD CONSTRAINT "SeatRow_venueMapVersionId_fkey" FOREIGN KEY ("venueMapVersionId") REFERENCES "VenueMapVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatRow" ADD CONSTRAINT "SeatRow_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceZone" ADD CONSTRAINT "PriceZone_venueMapVersionId_fkey" FOREIGN KEY ("venueMapVersionId") REFERENCES "VenueMapVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_venueMapVersionId_fkey" FOREIGN KEY ("venueMapVersionId") REFERENCES "VenueMapVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SeatRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_priceZoneId_fkey" FOREIGN KEY ("priceZoneId") REFERENCES "PriceZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_companionOfSeatId_fkey" FOREIGN KEY ("companionOfSeatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_venueMapVersionId_fkey" FOREIGN KEY ("venueMapVersionId") REFERENCES "VenueMapVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeat" ADD CONSTRAINT "EventSeat_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeat" ADD CONSTRAINT "EventSeat_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeat" ADD CONSTRAINT "EventSeat_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeat" ADD CONSTRAINT "EventSeat_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "TicketHold"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeat" ADD CONSTRAINT "EventSeat_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldItem" ADD CONSTRAINT "HoldItem_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "TicketHold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldItem" ADD CONSTRAINT "HoldItem_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventModerationAction" ADD CONSTRAINT "EventModerationAction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventModerationAction" ADD CONSTRAINT "EventModerationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerBatch" ADD CONSTRAINT "LedgerBatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerBatch" ADD CONSTRAINT "LedgerBatch_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerBatch" ADD CONSTRAINT "LedgerBatch_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerBatch" ADD CONSTRAINT "LedgerBatch_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerBatch" ADD CONSTRAINT "LedgerBatch_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerBatch" ADD CONSTRAINT "LedgerBatch_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerBatch" ADD CONSTRAINT "LedgerBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerBatch" ADD CONSTRAINT "LedgerBatch_compensatesBatchId_fkey" FOREIGN KEY ("compensatesBatchId") REFERENCES "LedgerBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LedgerBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_scannedByUserId_fkey" FOREIGN KEY ("scannedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationTask" ADD CONSTRAINT "ReconciliationTask_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationTask" ADD CONSTRAINT "ReconciliationTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ===========================================================================
-- 1. Backfills
-- ===========================================================================

-- Phase 1 carried a single `verified` boolean. It stays as the public badge;
-- the pipeline state is derived from it so no organisation starts out looking
-- less verified than it was.
UPDATE "Organization" SET "verificationStatus" = 'VERIFIED', "verificationUpdatedAt" = now()
WHERE "verified" = true;

-- Every organisation gets a first history row, so "how did it get this status"
-- is answerable for rows that predate the history table.
INSERT INTO "OrganizationVerificationEvent" ("id", "organizationId", "fromStatus", "toStatus", "reason", "createdAt")
SELECT
  'ove_' || substr(md5("id" || ':phase2-backfill'), 1, 21),
  "id",
  NULL,
  "verificationStatus",
  'Backfilled from the Phase 1 verified flag when the verification pipeline was introduced.',
  now()
FROM "Organization";

-- Venues need a slug to have a public page. Derived from name and city, with a
-- numeric suffix only where that collides, so the common case reads well and
-- the unique index can never reject the backfill.
WITH slugged AS (
  SELECT
    "id",
    trim(both '-' from regexp_replace(lower("name" || '-' || "city"), '[^a-z0-9]+', '-', 'g')) AS base,
    row_number() OVER (
      PARTITION BY trim(both '-' from regexp_replace(lower("name" || '-' || "city"), '[^a-z0-9]+', '-', 'g'))
      ORDER BY "createdAt", "id"
    ) AS n
  FROM "Venue"
)
UPDATE "Venue" v
SET "slug" = CASE WHEN s.n = 1 THEN s.base ELSE s.base || '-' || s.n END
FROM slugged s
WHERE v."id" = s."id" AND v."slug" IS NULL AND s.base <> '';

-- ===========================================================================
-- 2. CHECK constraints
--
-- Each one is an invariant the application also enforces. They are here for the
-- code path nobody thought of.
-- ===========================================================================

-- An order can never be refunded for more than it was paid, however many refund
-- requests race each other. `refundPendingCents` is reserved before the
-- provider is called, so the ceiling holds while a refund is in flight.
ALTER TABLE "Order"
  ADD CONSTRAINT "order_refund_within_total"
  CHECK ("refundedCents" >= 0 AND "refundPendingCents" >= 0
         AND "refundedCents" + "refundPendingCents" <= "totalCents");

-- Nor can one line give back more than it took.
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "order_item_refund_within_line"
  CHECK ("refundedQuantity" >= 0 AND "refundedQuantity" <= "quantity"
         AND "refundedCents" >= 0 AND "refundedCents" <= "subtotalCents");

-- A refund moves a positive amount, and its fee and reversal parts cannot
-- exceed it.
ALTER TABLE "Refund"
  ADD CONSTRAINT "refund_amounts_sane"
  CHECK ("amountCents" > 0
         AND "platformFeeRefundedCents" >= 0 AND "platformFeeRefundedCents" <= "amountCents"
         AND "transferReversedCents" >= 0 AND "transferReversedCents" <= "amountCents");

ALTER TABLE "RefundItem"
  ADD CONSTRAINT "refund_item_amounts_positive"
  CHECK ("quantity" > 0 AND "amountCents" >= 0);

-- A transfer cannot be reversed for more than it sent.
ALTER TABLE "Transfer"
  ADD CONSTRAINT "transfer_reversal_within_amount"
  CHECK ("amountCents" > 0 AND "reversedCents" >= 0 AND "reversedCents" <= "amountCents");

ALTER TABLE "Payout"
  ADD CONSTRAINT "payout_amount_positive"
  CHECK ("amountCents" > 0);

ALTER TABLE "Dispute"
  ADD CONSTRAINT "dispute_amount_positive"
  CHECK ("amountCents" > 0);

-- A ledger entry always carries a positive amount; the direction carries the
-- sign. A negative debit is a credit somebody did not think about.
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "ledger_entry_amount_positive"
  CHECK ("amountCents" > 0);

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "ledger_entry_currency_is_alpha3"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- The balance condition, as far as a row-level check can see it: a posted batch
-- has equal, positive debit and credit totals. The trigger below is what
-- computes those totals from the entries, so the two cannot be set to agree
-- with each other while disagreeing with reality.
ALTER TABLE "LedgerBatch"
  ADD CONSTRAINT "ledger_batch_posted_balances"
  CHECK ("status" <> 'POSTED' OR ("debitCents" = "creditCents" AND "debitCents" > 0));

ALTER TABLE "LedgerBatch"
  ADD CONSTRAINT "ledger_batch_posted_has_timestamp"
  CHECK ("status" <> 'POSTED' OR "postedAt" IS NOT NULL);

ALTER TABLE "LedgerBatch"
  ADD CONSTRAINT "ledger_batch_currency_is_alpha3"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- Only a CORRECTION batch may claim to compensate another.
ALTER TABLE "LedgerBatch"
  ADD CONSTRAINT "ledger_batch_correction_references"
  CHECK ("compensatesBatchId" IS NULL OR "kind" = 'CORRECTION');

-- A seat that says it is held must name the hold, and one that says it is sold
-- must name the line. Otherwise "held" is a claim nothing backs.
ALTER TABLE "EventSeat"
  ADD CONSTRAINT "event_seat_status_coherent"
  CHECK ((("status" = 'HELD') = ("holdId" IS NOT NULL))
         AND ("status" NOT IN ('SOLD', 'COMPLIMENTARY') OR "orderItemId" IS NOT NULL));

ALTER TABLE "EventSeat"
  ADD CONSTRAINT "event_seat_price_override_non_negative"
  CHECK ("priceCentsOverride" IS NULL OR "priceCentsOverride" >= 0);

-- A seat cannot be its own companion.
ALTER TABLE "Seat"
  ADD CONSTRAINT "seat_companion_is_another_seat"
  CHECK ("companionOfSeatId" IS NULL OR "companionOfSeatId" <> "id");

ALTER TABLE "VenueMapVersion"
  ADD CONSTRAINT "venue_map_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "HoldItem"
  ADD CONSTRAINT "hold_item_quantity_positive"
  CHECK ("quantity" >= 1);

ALTER TABLE "EventSession"
  ADD CONSTRAINT "event_session_ends_after_start"
  CHECK ("endsAt" > "startsAt");

ALTER TABLE "Session"
  ADD CONSTRAINT "session_expires_after_creation"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "Ticket"
  ADD CONSTRAINT "ticket_credential_version_positive"
  CHECK ("credentialVersion" >= 1);

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "notification_attempts_non_negative"
  CHECK ("attempts" >= 0 AND "maxAttempts" >= 1);

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "media_asset_size_positive"
  CHECK ("byteSize" > 0);

-- ===========================================================================
-- 3. Ledger protection
--
-- Two guarantees, in the database:
--
--   a. A batch cannot reach POSTED unless its entries balance in one currency.
--      The totals stored on the batch are computed here from the entries, so
--      they cannot be written to agree with each other and disagree with the
--      rows.
--   b. Once a batch is POSTED, neither it nor its entries can be updated or
--      deleted by anybody — including this application. A correction is a new
--      batch that references the one it compensates.
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_ledger_batch_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  debit_total  BIGINT;
  credit_total BIGINT;
  currencies   INT;
  foreign_rows INT;
BEGIN
  -- Only the transition into POSTED is interesting. A draft may be anything;
  -- an already-posted row is handled by the immutability trigger.
  IF NEW."status" <> 'POSTED' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'POSTED' THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN "direction" = 'DEBIT'  THEN "amountCents" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amountCents" ELSE 0 END), 0),
    COUNT(DISTINCT "currency"),
    COUNT(*) FILTER (WHERE "currency" <> NEW."currency")
  INTO debit_total, credit_total, currencies, foreign_rows
  FROM "LedgerEntry" WHERE "batchId" = NEW."id";

  IF debit_total = 0 AND credit_total = 0 THEN
    RAISE EXCEPTION 'ledger batch % cannot be posted with no entries', NEW."reference"
      USING ERRCODE = 'check_violation';
  END IF;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'ledger batch % does not balance: debits %, credits %',
      NEW."reference", debit_total, credit_total
      USING ERRCODE = 'check_violation';
  END IF;

  IF currencies > 1 OR foreign_rows > 0 THEN
    RAISE EXCEPTION 'ledger batch % mixes currencies; every entry must be in %',
      NEW."reference", NEW."currency"
      USING ERRCODE = 'check_violation';
  END IF;

  -- The totals are money columns, so they must fit the money column width.
  IF debit_total > 2147483647 THEN
    RAISE EXCEPTION 'ledger batch % exceeds the money ceiling', NEW."reference"
      USING ERRCODE = 'numeric_value_out_of_range';
  END IF;

  NEW."debitCents"  := debit_total;
  NEW."creditCents" := credit_total;
  IF NEW."postedAt" IS NULL THEN
    NEW."postedAt" := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION desi_ledger_batch_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'POSTED' THEN
      RAISE EXCEPTION 'ledger batch % is posted and cannot be deleted; post a CORRECTION batch instead', OLD."reference"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'ledger batch % is posted and cannot be modified; post a CORRECTION batch instead', OLD."reference"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION desi_ledger_entry_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  batch_status TEXT;
  batch_ref    TEXT;
BEGIN
  SELECT "status"::text, "reference" INTO batch_status, batch_ref
  FROM "LedgerBatch"
  WHERE "id" = COALESCE(OLD."batchId", NEW."batchId");

  IF batch_status = 'POSTED' THEN
    RAISE EXCEPTION 'ledger batch % is posted; its entries cannot be inserted, changed or removed', batch_ref
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger names are chosen so that, on UPDATE, the balance trigger runs before
-- the immutability trigger: PostgreSQL fires BEFORE triggers in name order, and
-- 'desi_ledger_batch_balance' sorts before 'desi_ledger_batch_immutable'.
CREATE TRIGGER desi_ledger_batch_balance
  BEFORE INSERT OR UPDATE ON "LedgerBatch"
  FOR EACH ROW EXECUTE FUNCTION desi_ledger_batch_balance();

CREATE TRIGGER desi_ledger_batch_immutable
  BEFORE UPDATE OR DELETE ON "LedgerBatch"
  FOR EACH ROW EXECUTE FUNCTION desi_ledger_batch_immutable();

CREATE TRIGGER desi_ledger_entry_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION desi_ledger_entry_immutable();

-- ===========================================================================
-- 4. Chart of accounts
--
-- Structure, not sample data: every database needs these rows for a payment to
-- be recordable at all, so they are created here rather than by the seed. Ids
-- are deterministic so a fixture and a fresh database agree.
-- ===========================================================================

INSERT INTO "LedgerAccount" ("id", "code", "name", "type", "currency", "active", "createdAt") VALUES
  ('ledacc0000000processorclear', 'processor_clearing',  'Processor clearing',        'ASSET',          NULL, true, now()),
  ('ledacc0000000organizerpaybl', 'organizer_payable',   'Organiser payable',         'LIABILITY',      NULL, true, now()),
  ('ledacc0000000platformfeerev', 'platform_fee_revenue','Platform fee revenue',      'REVENUE',        NULL, true, now()),
  ('ledacc0000000taxpayable0000', 'tax_payable',         'Tax payable',               'LIABILITY',      NULL, true, now()),
  ('ledacc0000000refundclearing', 'refund_clearing',     'Refund clearing',           'LIABILITY',      NULL, true, now()),
  ('ledacc0000000disputeclearin', 'dispute_clearing',    'Dispute clearing',          'LIABILITY',      NULL, true, now()),
  ('ledacc0000000transferclearg', 'transfer_clearing',   'Transfer clearing',         'ASSET',          NULL, true, now()),
  ('ledacc0000000payoutclearing', 'payout_clearing',     'Payout clearing',           'ASSET',          NULL, true, now()),
  ('ledacc0000000promotionaldis', 'promotional_discount','Promotional discount',      'CONTRA_REVENUE', NULL, true, now()),
  ('ledacc0000000paymentfeeexpe', 'payment_fee_expense', 'Payment processing fees',   'EXPENSE',        NULL, true, now())
ON CONFLICT ("code") DO NOTHING;
