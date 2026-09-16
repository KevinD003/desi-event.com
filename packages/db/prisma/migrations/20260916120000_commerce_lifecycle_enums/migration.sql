-- ---------------------------------------------------------------------------
-- The lifecycle labels the commerce services need.
--
-- This migration adds enum values and does nothing else, on purpose.
-- PostgreSQL permits `ALTER TYPE ... ADD VALUE` inside a transaction block, but
-- it refuses to *use* the new label until that transaction commits. Prisma runs
-- each migration file in one transaction, so a file that added `SCHEDULED` and
-- then set it as a column default would fail on the default. Splitting the two
-- is the documented way round it, and the split is why the next migration can
-- reference everything added here.
--
-- Every `AFTER`/`BEFORE` clause is deliberate: `verify:upgrade` compares
-- `pg_enum.enumsortorder` between a freshly migrated database and an upgraded
-- one, and `schema.prisma` lists the labels in the order these clauses produce,
-- so the file and `\dT+` agree.
--
-- Nothing here is destructive. Labels that Phase 2 wrote and this phase renames
-- are kept, not dropped: a row already carrying `PROCESSING` stays readable.
-- ---------------------------------------------------------------------------

-- A ticket can be mid-transfer, and it can be withdrawn by the organiser.
-- Neither state existed, so both were previously expressed by not expressing
-- them: a pending transfer was invisible on the ticket, and a revocation was
-- spelled VOID, which is also what a mistake is spelled.
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'TRANSFER_PENDING' AFTER 'VALID';
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'REVOKED' AFTER 'TRANSFER_PENDING';

-- A refund that has been handed to the provider is not the same as one the
-- provider refused, and neither is the same as one the provider did not answer.
-- Collapsing the three is how a timeout becomes a fabricated failure.
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED' AFTER 'APPROVED';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'DECLINED' AFTER 'SUCCEEDED';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'TIMEOUT' AFTER 'FAILED';

ALTER TYPE "DisputeStatus" ADD VALUE IF NOT EXISTS 'OPENED' BEFORE 'NEEDS_RESPONSE';
ALTER TYPE "DisputeStatus" ADD VALUE IF NOT EXISTS 'CLOSED' AFTER 'LOST';

ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED' AFTER 'PENDING';

-- A payout is scheduled by us and identified by the provider, so it has a life
-- before the provider has ever heard of it. It can also be held, reversed, or
-- left unanswered, and none of those is 'FAILED'.
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED' BEFORE 'PENDING';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED' AFTER 'IN_TRANSIT';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'REVERSED' AFTER 'FAILED';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'HELD' AFTER 'REVERSED';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'RECONCILIATION_REQUIRED' AFTER 'HELD';

-- CLAIMED carries a lease; SENDING did not, so two workers could both be
-- "SENDING" the same row and neither could tell. RETRY_SCHEDULED separates
-- "will be tried again" from "has failed", and CANCELLED lets a domain event or
-- an operator withdraw a message that has not gone out.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'CLAIMED' AFTER 'QUEUED';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'RETRY_SCHEDULED' AFTER 'SENT';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED' AFTER 'RETRY_SCHEDULED';
