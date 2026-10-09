-- Payment terms and referral codes (SPEC3 §5.2, ADR 0016).
--
-- An administrator sets each event's own booking fee (the platform fee) or
-- leaves the site default, and switches paying at the venue on or off with a
-- limit on unpaid places. Every decision is a row of its own: fee decisions in
-- "EventFeeSetting" (never edited) and switch changes in
-- "EventVenuePaymentChange". Referral codes waive an order's whole booking fee.
-- Each order records the terms it was priced with, so it never reprices.
--
-- Only apps/api/src/lib/payment-terms.js writes the Event fee and switch
-- columns, "EventFeeSetting" and "EventVenuePaymentChange"; only
-- apps/api/src/lib/referral-codes.js writes "ReferralCode" (except "useCount",
-- written by apps/api/src/lib/referral-uses.js) and "ReferralCodeEvent".
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction. Every
-- trigger raising 23514 also writes its constraint name into the message,
-- because the driver adapter passes on the SQLSTATE and the message but not
-- the constraint field.
--
-- Rollback (manual, in order, after 20261009110000_pay_at_the_venue is rolled
-- back):
--   DROP TRIGGER desi_event_fee_setting_append_only ON "EventFeeSetting";
--   DROP FUNCTION desi_event_fee_setting_append_only();
--   ALTER TABLE "Order" DROP CONSTRAINT "order_fee_parts",
--     DROP CONSTRAINT "order_fee_waiver_whole", DROP CONSTRAINT "order_fee_terms_shape";
--   ALTER TABLE "Order" DROP CONSTRAINT "Order_feeSettingId_fkey",
--     DROP CONSTRAINT "Order_referralCodeId_fkey";
--   DROP INDEX "Order_feeSettingId_idx"; DROP INDEX "Order_referralCodeId_status_idx";
--   DROP INDEX "Order_eventId_paymentMethod_status_idx";
--   ALTER TABLE "Order" DROP COLUMN "paymentMethod", DROP COLUMN "feeSource",
--     DROP COLUMN "feeSettingId", DROP COLUMN "feePercentageBps",
--     DROP COLUMN "feeFlatCentsPerTicket", DROP COLUMN "feeGrossCents",
--     DROP COLUMN "feeWaivedCents", DROP COLUMN "referralCodeId";
--   ALTER TABLE "Event" DROP CONSTRAINT "event_fee_shape",
--     DROP CONSTRAINT "event_venue_payment_shape",
--     DROP CONSTRAINT "Event_feeSettingId_fkey",
--     DROP CONSTRAINT "Event_venuePaymentChangedById_fkey";
--   DROP INDEX "Event_feeSettingId_key"; DROP INDEX "Event_venuePaymentChangedById_idx";
--   ALTER TABLE "Event" DROP COLUMN "feeSource", DROP COLUMN "feePercentageBps",
--     DROP COLUMN "feeFlatCentsPerTicket", DROP COLUMN "feeCurrency",
--     DROP COLUMN "feeSettingId", DROP COLUMN "venuePaymentEnabled",
--     DROP COLUMN "venuePaymentLimit", DROP COLUMN "venuePaymentChangedAt",
--     DROP COLUMN "venuePaymentChangedById", DROP COLUMN "venuePaymentReason";
--   DROP TABLE "ReferralCodeEvent"; DROP TABLE "ReferralCode";
--   DROP TABLE "EventVenuePaymentChange"; DROP TABLE "EventFeeSetting";
--   DROP TYPE "ReferralCodeScope"; DROP TYPE "OrderPaymentMethod"; DROP TYPE "FeeSource";

-- ============================================================================
-- 1. Enums
-- ============================================================================

-- CreateEnum
CREATE TYPE "FeeSource" AS ENUM ('SITE_DEFAULT', 'EVENT');

-- CreateEnum
CREATE TYPE "OrderPaymentMethod" AS ENUM ('CARD', 'AT_VENUE');

-- CreateEnum
CREATE TYPE "ReferralCodeScope" AS ENUM ('ALL_EVENTS', 'SELECTED_EVENTS');

-- ============================================================================
-- 2. Columns and tables
-- ============================================================================

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "feeCurrency" TEXT,
ADD COLUMN     "feeFlatCentsPerTicket" INTEGER,
ADD COLUMN     "feePercentageBps" INTEGER,
ADD COLUMN     "feeSettingId" TEXT,
ADD COLUMN     "feeSource" "FeeSource" NOT NULL DEFAULT 'SITE_DEFAULT',
ADD COLUMN     "venuePaymentChangedAt" TIMESTAMP(3),
ADD COLUMN     "venuePaymentChangedById" TEXT,
ADD COLUMN     "venuePaymentEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "venuePaymentLimit" INTEGER,
ADD COLUMN     "venuePaymentReason" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "feeFlatCentsPerTicket" INTEGER,
ADD COLUMN     "feeGrossCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "feePercentageBps" INTEGER,
ADD COLUMN     "feeSettingId" TEXT,
ADD COLUMN     "feeSource" "FeeSource" NOT NULL DEFAULT 'SITE_DEFAULT',
ADD COLUMN     "feeWaivedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentMethod" "OrderPaymentMethod" NOT NULL DEFAULT 'CARD',
ADD COLUMN     "referralCodeId" TEXT;

-- CreateTable
CREATE TABLE "EventFeeSetting" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "source" "FeeSource" NOT NULL,
    "percentageBps" INTEGER,
    "flatCentsPerTicket" INTEGER,
    "currency" TEXT,
    "reason" TEXT NOT NULL,
    "setById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventFeeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventVenuePaymentChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "limit" INTEGER,
    "reason" TEXT NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventVenuePaymentChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "scope" "ReferralCodeScope" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "switchedOffAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCodeEvent" (
    "referralCodeId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCodeEvent_pkey" PRIMARY KEY ("referralCodeId","eventId")
);

-- CreateIndex
CREATE INDEX "EventFeeSetting_setById_idx" ON "EventFeeSetting"("setById");

-- CreateIndex
CREATE UNIQUE INDEX "EventFeeSetting_eventId_sequence_key" ON "EventFeeSetting"("eventId", "sequence");

-- CreateIndex
CREATE INDEX "EventVenuePaymentChange_eventId_createdAt_idx" ON "EventVenuePaymentChange"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "EventVenuePaymentChange_changedById_idx" ON "EventVenuePaymentChange"("changedById");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX "ReferralCode_active_expiresAt_idx" ON "ReferralCode"("active", "expiresAt");

-- CreateIndex
CREATE INDEX "ReferralCode_createdById_idx" ON "ReferralCode"("createdById");

-- CreateIndex
CREATE INDEX "ReferralCode_updatedById_idx" ON "ReferralCode"("updatedById");

-- CreateIndex
CREATE INDEX "ReferralCodeEvent_eventId_idx" ON "ReferralCodeEvent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_feeSettingId_key" ON "Event"("feeSettingId");

-- CreateIndex
CREATE INDEX "Event_venuePaymentChangedById_idx" ON "Event"("venuePaymentChangedById");

-- CreateIndex
CREATE INDEX "Order_feeSettingId_idx" ON "Order"("feeSettingId");

-- CreateIndex
CREATE INDEX "Order_referralCodeId_status_idx" ON "Order"("referralCodeId", "status");

-- CreateIndex
CREATE INDEX "Order_eventId_paymentMethod_status_idx" ON "Order"("eventId", "paymentMethod", "status");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_feeSettingId_fkey" FOREIGN KEY ("feeSettingId") REFERENCES "EventFeeSetting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venuePaymentChangedById_fkey" FOREIGN KEY ("venuePaymentChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFeeSetting" ADD CONSTRAINT "EventFeeSetting_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFeeSetting" ADD CONSTRAINT "EventFeeSetting_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVenuePaymentChange" ADD CONSTRAINT "EventVenuePaymentChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVenuePaymentChange" ADD CONSTRAINT "EventVenuePaymentChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCodeEvent" ADD CONSTRAINT "ReferralCodeEvent_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCodeEvent" ADD CONSTRAINT "ReferralCodeEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_feeSettingId_fkey" FOREIGN KEY ("feeSettingId") REFERENCES "EventFeeSetting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An order that used a code keeps it: deleting the code is refused while any
-- order names it (a code is switched off, never deleted).
-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 3. Backfill
-- ============================================================================
--
-- 1. No waiver existed, so every order's gross fee is the fee it charged.
-- 2. Where the order's snapshot carries usable fee terms, the order records
--    them. The value is checked to be a short run of digits before it is cast,
--    inside a CASE so the cast never runs on anything else; an order without a
--    usable snapshot keeps both terms null ("terms not recorded").
-- 3. Every order is CARD, SITE_DEFAULT, with no setting and no referral code,
--    and every event is SITE_DEFAULT with the switch off and no limit: the
--    column defaults.

UPDATE "Order" SET "feeGrossCents" = "feesCents";

UPDATE "Order"
SET "feePercentageBps" = ("pricingSnapshot"->'feeConfig'->>'percentageBps')::int,
    "feeFlatCentsPerTicket" = ("pricingSnapshot"->'feeConfig'->>'flatCents')::int
WHERE jsonb_typeof("pricingSnapshot"->'feeConfig'->'percentageBps') = 'number'
  AND jsonb_typeof("pricingSnapshot"->'feeConfig'->'flatCents') = 'number'
  AND (CASE
         WHEN ("pricingSnapshot"->'feeConfig'->>'percentageBps') ~ '^[0-9]{1,6}$'
         THEN ("pricingSnapshot"->'feeConfig'->>'percentageBps')::int
       END) BETWEEN 0 AND 10000
  AND (CASE
         WHEN ("pricingSnapshot"->'feeConfig'->>'flatCents') ~ '^[0-9]{1,6}$'
         THEN ("pricingSnapshot"->'feeConfig'->>'flatCents')::int
       END) BETWEEN 0 AND 100000;

-- ============================================================================
-- 4. CHECK constraints
-- ============================================================================
--
-- Every row satisfies them after the backfill (the upgrade verifier proves
-- it), so none is added NOT VALID.

-- An event's own fee: none stored for the site default; for EVENT terms, a
-- percentage of 0-30.00%, an amount per ticket of 0-100.00 and the currency the
-- event sells in. An event returned to the site default keeps "feeSettingId"
-- null: its SITE_DEFAULT row is in the history, and the current pointer exists
-- only for EVENT terms. The EVENT branch says IS NOT NULL in so many words: a
-- CHECK whose expression is NULL passes, so "NULL BETWEEN 0 AND 3000" alone
-- would let an EVENT row through with no numbers.
ALTER TABLE "Event" ADD CONSTRAINT "event_fee_shape" CHECK (
  ("feeSource" = 'SITE_DEFAULT'
    AND "feePercentageBps" IS NULL AND "feeFlatCentsPerTicket" IS NULL
    AND "feeCurrency" IS NULL AND "feeSettingId" IS NULL)
  OR ("feeSource" = 'EVENT'
    AND "feePercentageBps" IS NOT NULL AND "feeFlatCentsPerTicket" IS NOT NULL
    AND "feeCurrency" IS NOT NULL
    AND "feePercentageBps" BETWEEN 0 AND 3000
    AND "feeFlatCentsPerTicket" BETWEEN 0 AND 10000
    AND "feeCurrency" ~ '^[A-Z]{3}$')
);

-- The pay-at-the-venue switch: a reason of 10-500 characters, a limit of
-- 1-100000, and a switch that is on has a limit and the time it was changed.
ALTER TABLE "Event" ADD CONSTRAINT "event_venue_payment_shape" CHECK (
  ("venuePaymentReason" IS NULL OR char_length(btrim("venuePaymentReason")) BETWEEN 10 AND 500)
  AND ("venuePaymentLimit" IS NULL OR "venuePaymentLimit" BETWEEN 1 AND 100000)
  AND ("venuePaymentEnabled" = false
       OR ("venuePaymentChangedAt" IS NOT NULL AND "venuePaymentLimit" IS NOT NULL))
);

ALTER TABLE "EventFeeSetting" ADD CONSTRAINT "event_fee_setting_shape" CHECK (
  "sequence" >= 1
  AND char_length(btrim("reason")) BETWEEN 10 AND 500
  AND (
    ("source" = 'SITE_DEFAULT'
      AND "percentageBps" IS NULL AND "flatCentsPerTicket" IS NULL AND "currency" IS NULL)
    OR ("source" = 'EVENT'
      AND "percentageBps" IS NOT NULL AND "flatCentsPerTicket" IS NOT NULL
      AND "currency" IS NOT NULL
      AND "percentageBps" BETWEEN 0 AND 3000
      AND "flatCentsPerTicket" BETWEEN 0 AND 10000
      AND "currency" ~ '^[A-Z]{3}$')
  )
);

ALTER TABLE "EventVenuePaymentChange" ADD CONSTRAINT "event_venue_payment_change_shape" CHECK (
  char_length(btrim("reason")) BETWEEN 10 AND 500
  AND ("limit" IS NULL OR "limit" BETWEEN 1 AND 100000)
  AND (NOT "enabled" OR "limit" IS NOT NULL)
);

-- The code's text: 6-32 of A-Z, 0-9 and '-', beginning and ending with a
-- letter or digit, never '--' (`referralCodeStringSchema`, upper case).
ALTER TABLE "ReferralCode" ADD CONSTRAINT "referral_code_shape" CHECK (
  "code" ~ '^[A-Z0-9][A-Z0-9-]{4,30}[A-Z0-9]$' AND position('--' in "code") = 0
  AND ("label" IS NULL OR char_length(btrim("label")) BETWEEN 1 AND 120)
  AND ("maxUses" IS NULL OR "maxUses" BETWEEN 1 AND 1000000)
  AND "useCount" >= 0
  AND ("expiresAt" IS NULL OR "expiresAt" > "createdAt")
  AND ("active" OR "switchedOffAt" IS NOT NULL)
);

-- Separate from the shape, so its refusal maps to the buyer's answer
-- (REFERRAL_NOT_ACCEPTED) whatever the code path that counted past the limit.
ALTER TABLE "ReferralCode" ADD CONSTRAINT "referral_code_use_within_limit" CHECK (
  "maxUses" IS NULL OR "useCount" <= "maxUses"
);

-- The fee charged is the gross fee less the waiver.
ALTER TABLE "Order" ADD CONSTRAINT "order_fee_parts" CHECK (
  "feeGrossCents" >= 0 AND "feeWaivedCents" >= 0
  AND "feeWaivedCents" <= "feeGrossCents"
  AND "feesCents" = "feeGrossCents" - "feeWaivedCents"
);

-- A referral code waives the whole fee, and only a code waives anything.
ALTER TABLE "Order" ADD CONSTRAINT "order_fee_waiver_whole" CHECK (
  ("referralCodeId" IS NULL AND "feeWaivedCents" = 0)
  OR ("referralCodeId" IS NOT NULL AND "feeWaivedCents" = "feeGrossCents" AND "feeGrossCents" > 0)
);

-- The terms used: both or neither, within the environment's bounds (a
-- site-default order records the site's numbers, `env.js` PLATFORM_FEE_BPS and
-- PLATFORM_FEE_FLAT_CENTS). The last clause keeps an EVENT order explainable
-- after its setting row is gone.
ALTER TABLE "Order" ADD CONSTRAINT "order_fee_terms_shape" CHECK (
  (("feePercentageBps" IS NULL) = ("feeFlatCentsPerTicket" IS NULL))
  AND ("feePercentageBps" IS NULL OR "feePercentageBps" BETWEEN 0 AND 10000)
  AND ("feeFlatCentsPerTicket" IS NULL OR "feeFlatCentsPerTicket" BETWEEN 0 AND 100000)
  AND ("feeSource" = 'SITE_DEFAULT' OR "feeSettingId" IS NOT NULL OR "feePercentageBps" IS NOT NULL)
);

-- ============================================================================
-- 5. A fee decision is never edited
-- ============================================================================
--
-- Orders point at the decision they were priced with, so the row has to keep
-- saying what it said. An UPDATE may only clear "setById" (the foreign key's
-- SET NULL when the administrator's account is deleted); a DELETE is allowed
-- only as the cascade from the event row being removed, when the event is
-- already gone.
CREATE OR REPLACE FUNCTION desi_event_fee_setting_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "Event" WHERE "id" = OLD."eventId") THEN
      RAISE EXCEPTION 'fee setting % is a record of a decision and is never deleted (event_fee_setting_append_only)',
        OLD."id"
        USING ERRCODE = '23514', CONSTRAINT = 'event_fee_setting_append_only';
    END IF;
    RETURN OLD;
  END IF;

  IF (NEW."id", NEW."eventId", NEW."sequence", NEW."source", NEW."percentageBps",
      NEW."flatCentsPerTicket", NEW."currency", NEW."reason", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."eventId", OLD."sequence", OLD."source", OLD."percentageBps",
      OLD."flatCentsPerTicket", OLD."currency", OLD."reason", OLD."createdAt")
     OR (NEW."setById" IS DISTINCT FROM OLD."setById" AND NEW."setById" IS NOT NULL) THEN
    RAISE EXCEPTION 'fee setting % is a record of a decision and is never edited (event_fee_setting_append_only)',
      OLD."id"
      USING ERRCODE = '23514', CONSTRAINT = 'event_fee_setting_append_only';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_event_fee_setting_append_only
  BEFORE UPDATE OR DELETE ON "EventFeeSetting"
  FOR EACH ROW EXECUTE FUNCTION desi_event_fee_setting_append_only();
