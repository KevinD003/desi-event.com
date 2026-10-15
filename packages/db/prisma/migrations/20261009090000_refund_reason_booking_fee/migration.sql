-- A refund of an order's booking fee alone, made by hand by the Desi-Event
-- team (`platformFees.refund`, SPEC3 §7.4), records its own reason.
--
-- A migration of its own: PostgreSQL does not let a transaction use an enum
-- label it added, and the code that uses it comes later. No row is changed
-- here.
--
-- Rollback: PostgreSQL cannot drop an enum label. Recreate "RefundReason"
-- without it, after changing every BOOKING_FEE refund's reason.
ALTER TYPE "RefundReason" ADD VALUE IF NOT EXISTS 'BOOKING_FEE';
