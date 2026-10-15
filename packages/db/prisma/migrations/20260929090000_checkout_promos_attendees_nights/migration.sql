-- Checkout: labelled nights, attendee names staged for settlement, and promo
-- code integrity.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction.
--
-- The one-reserved-tier-per-zone rule this area relies on is the partial
-- unique index "TicketType_reserved_session_zone_key", created once by
-- 20260928090000_event_authoring_content_and_tier_rules. It is deliberately not
-- created a second time here under another name.
--
-- Rollback:
--   drop the constraints below, DROP INDEX "PromoCode_organizationId_createdAt_idx";
--   ALTER TABLE "HoldItem" DROP COLUMN "attendeeName";
--   ALTER TABLE "OrderItem" DROP COLUMN "attendeeNames";
--   ALTER TABLE "EventSession" DROP COLUMN "label";
--   (Promo code rows normalised by the backfills keep their new values.)

-- ============================================================================
-- 1. Nights
-- ============================================================================

-- AlterTable
ALTER TABLE "EventSession" ADD COLUMN     "label" TEXT;

ALTER TABLE "EventSession" ADD CONSTRAINT "event_session_label_length"
  CHECK ("label" IS NULL OR char_length(btrim("label")) BETWEEN 1 AND 60);

-- ============================================================================
-- 2. Group booking: names staged until settlement issues the tickets
-- ============================================================================
--
-- Existing lines get the empty list from the default, which is within every
-- quantity; a seated hold item has no name until a buyer types one.

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "attendeeNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_attendee_names_within_quantity"
  CHECK (cardinality("attendeeNames") <= "quantity");

-- AlterTable
ALTER TABLE "HoldItem" ADD COLUMN     "attendeeName" TEXT;

ALTER TABLE "HoldItem" ADD CONSTRAINT "hold_item_attendee_name_seated"
  CHECK ("attendeeName" IS NULL OR ("eventSeatId" IS NOT NULL AND char_length("attendeeName") BETWEEN 1 AND 100));

-- ============================================================================
-- 3. PromoCode integrity
-- ============================================================================
--
-- Backfills first; each one preserves the row's current meaning, so a code
-- that could not apply before still cannot, and one that was exhausted stays
-- exhausted.

UPDATE "PromoCode" SET "currency" = NULL
  WHERE "type" = 'PERCENTAGE' AND "currency" IS NOT NULL;
-- computeDiscount already clamps a percentage at 100%.
UPDATE "PromoCode" SET "value" = 10000
  WHERE "type" = 'PERCENTAGE' AND "value" > 10000;
UPDATE "PromoCode" SET "value" = 0 WHERE "value" < 0;
UPDATE "PromoCode" SET "redemptionCount" = 0 WHERE "redemptionCount" < 0;
-- A cap below one never admitted a redemption: keep it closed.
UPDATE "PromoCode" SET "active" = false, "maxRedemptions" = GREATEST("redemptionCount", 1)
  WHERE "maxRedemptions" IS NOT NULL AND "maxRedemptions" < 1;
-- Over its cap: it stays exhausted.
UPDATE "PromoCode" SET "maxRedemptions" = "redemptionCount"
  WHERE "maxRedemptions" IS NOT NULL AND "redemptionCount" > "maxRedemptions";
-- A window that closes before it opens was never applicable: keep it so.
UPDATE "PromoCode" SET "active" = false, "startsAt" = NULL
  WHERE "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" <= "startsAt";

ALTER TABLE "PromoCode" ADD CONSTRAINT "promo_code_value_in_range"
  CHECK ("value" >= 0 AND ("type" <> 'PERCENTAGE' OR "value" <= 10000));
ALTER TABLE "PromoCode" ADD CONSTRAINT "promo_code_percentage_has_no_currency"
  CHECK ("type" <> 'PERCENTAGE' OR "currency" IS NULL);
ALTER TABLE "PromoCode" ADD CONSTRAINT "promo_code_redemptions_within_cap"
  CHECK ("redemptionCount" >= 0 AND ("maxRedemptions" IS NULL OR ("maxRedemptions" >= 1 AND "redemptionCount" <= "maxRedemptions")));
ALTER TABLE "PromoCode" ADD CONSTRAINT "promo_code_window_ordered"
  CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt");

-- CreateIndex: the organiser's promo code list.
CREATE INDEX "PromoCode_organizationId_createdAt_idx" ON "PromoCode"("organizationId", "createdAt");

-- Deliberately not added: a CHECK on PromoCode.code's shape. Existing rows may
-- not match it, and an upper-casing backfill could collide with
-- @@unique([organizationId, code]). The request schema normalises every write
-- and every lookup instead.
