-- Group pass: one QR pass that admits every ticket of an order still held by
-- its buyer.
--
-- No backfill: GroupPass rows are created lazily on the holder's first
-- retrieval, and existing CheckIn rows keep "groupPassId" NULL. No existing
-- row's meaning changes.
--
-- Rollback:
--   DROP TRIGGER desi_check_in_group_pass_matches ON "CheckIn";
--   DROP FUNCTION desi_check_in_group_pass_matches();
--   ALTER TABLE "CheckIn" DROP COLUMN "groupPassId";
--   DROP TABLE "GroupPass";

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "groupPassId" TEXT;

-- CreateTable
CREATE TABLE "GroupPass" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "credentialHash" TEXT,
    "codeHash" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialIssuedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupPass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupPass_orderId_key" ON "GroupPass"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPass_credentialHash_key" ON "GroupPass"("credentialHash");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPass_codeHash_key" ON "GroupPass"("codeHash");

-- CreateIndex
CREATE INDEX "CheckIn_groupPassId_idx" ON "CheckIn"("groupPassId");

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_groupPassId_fkey" FOREIGN KEY ("groupPassId") REFERENCES "GroupPass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPass" ADD CONSTRAINT "GroupPass_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Integrity the schema cannot express
-- ============================================================================

ALTER TABLE "GroupPass" ADD CONSTRAINT "group_pass_version_positive"
  CHECK ("credentialVersion" >= 1);

-- Digests, never plaintext: a 'G1.' credential or a 'DEG-' code can never
-- satisfy this, so a plaintext written by mistake is refused rather than kept.
ALTER TABLE "GroupPass" ADD CONSTRAINT "group_pass_digests_are_sha256" CHECK (
  ("credentialHash" IS NULL OR "credentialHash" ~ '^[0-9a-f]{64}$') AND
  ("codeHash" IS NULL OR "codeHash" ~ '^[0-9a-f]{64}$'));

-- Issued together or not at all (the row is created, then derived, in one
-- transaction).
ALTER TABLE "GroupPass" ADD CONSTRAINT "group_pass_digests_together"
  CHECK (("credentialHash" IS NULL) = ("codeHash" IS NULL));

-- A group admission is only of a ticket on the group's own order, held by that
-- order's buyer, at the moment of insert (plpgsql per ADR 0004). Fires
-- alongside desi_check_in_ticket_admissible; a CheckIn with no group pass is
-- untouched.
CREATE OR REPLACE FUNCTION desi_check_in_group_pass_matches() RETURNS trigger AS $$
DECLARE
  pass_order TEXT;
  buyer TEXT;
  ticket_order TEXT;
  ticket_owner TEXT;
BEGIN
  IF NEW."groupPassId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT gp."orderId", o."userId" INTO pass_order, buyer
    FROM "GroupPass" gp JOIN "Order" o ON o."id" = gp."orderId"
    WHERE gp."id" = NEW."groupPassId";

  SELECT oi."orderId", t."ownerUserId" INTO ticket_order, ticket_owner
    FROM "Ticket" t JOIN "OrderItem" oi ON oi."id" = t."orderItemId"
    WHERE t."id" = NEW."ticketId";

  IF pass_order IS NULL OR pass_order IS DISTINCT FROM ticket_order THEN
    RAISE EXCEPTION 'check-in refused: group pass % does not cover ticket %',
      NEW."groupPassId", NEW."ticketId";
  END IF;

  IF buyer IS NULL OR ticket_owner IS DISTINCT FROM buyer THEN
    RAISE EXCEPTION 'check-in refused: ticket % is not held by the group pass''s buyer',
      NEW."ticketId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER desi_check_in_group_pass_matches
  BEFORE INSERT ON "CheckIn"
  FOR EACH ROW EXECUTE FUNCTION desi_check_in_group_pass_matches();
