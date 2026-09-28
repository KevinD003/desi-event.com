-- Team invitations say how their code went out, one live invitation per
-- address per organisation, and an organisation records who created it.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction.
--
-- Rollback:
--   DROP INDEX "Invitation_one_pending_per_address";
--   ALTER TABLE "Organization" DROP CONSTRAINT "Organization_createdById_fkey";
--   DROP INDEX "Organization_createdById_createdAt_idx";
--   ALTER TABLE "Organization" DROP COLUMN "createdById";
--   ALTER TABLE "Invitation" DROP COLUMN "deliveryMode"; DROP TYPE "InvitationDelivery";
--   (Invitations superseded by the backfill below stay REVOKED.)

-- CreateEnum
CREATE TYPE "InvitationDelivery" AS ENUM ('EMAIL', 'MANUAL');

-- AlterTable: how an invitation's code went out. Nullable, no backfill: rows
-- issued before this migration were never delivered to anybody.
ALTER TABLE "Invitation" ADD COLUMN     "deliveryMode" "InvitationDelivery";

-- AlterTable: who created an organisation from the site. Nullable with
-- ON DELETE SET NULL: organisations created any other way have no creator, and
-- a person who has acted is redacted rather than deleted.
ALTER TABLE "Organization" ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "Organization_createdById_createdAt_idx" ON "Organization"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- One live code per address per organisation
-- ============================================================================
--
-- Backfill before the unique index: supersede duplicate live invitations to
-- the same address (the older ones lose), which is exactly what the invite
-- route intended. Case-insensitive, like the index.
UPDATE "Invitation" AS i
   SET "status" = 'REVOKED', "revokedAt" = COALESCE(i."revokedAt", now())
 WHERE i."status" = 'PENDING'
   AND EXISTS (
     SELECT 1 FROM "Invitation" AS j
      WHERE j."organizationId" = i."organizationId"
        AND lower(j."email") = lower(i."email")
        AND j."status" = 'PENDING'
        AND (j."createdAt" > i."createdAt" OR (j."createdAt" = i."createdAt" AND j."id" > i."id"))
   );

-- A partial expression index, which Prisma's schema language cannot express
-- (same approach as 20260914213145_facet_indexes); schema.prisma carries a
-- comment above model Invitation pointing here. Two invites racing to one
-- address now end as one 201 and one refusal rather than two live codes.
CREATE UNIQUE INDEX "Invitation_one_pending_per_address"
  ON "Invitation" ("organizationId", lower("email"))
  WHERE "status" = 'PENDING';
