-- The platform administrator: narrower than SUPER_ADMIN. The name was Phase 1's
-- catch-all, which 20260915010000_phase2_commerce_and_operations mapped to
-- SUPER_ADMIN and dropped; no row holds it and none is changed here.
--
-- A migration of its own: PostgreSQL does not let a transaction use an enum
-- label it added, so nothing else may run in this file.
--
-- Rollback: PostgreSQL cannot drop an enum label. Recreate "UserRole" without
-- it, as 20260915010000 did, after moving any ADMIN row to another role.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN' BEFORE 'SUPER_ADMIN';
