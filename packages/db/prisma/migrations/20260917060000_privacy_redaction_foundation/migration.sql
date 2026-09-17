-- Personal data: redaction, holds, retention, and the evidence of both.
--
-- Phase 3's foundation. Nothing here redacts anything: these are the records
-- the redaction service will write, the holds it must respect, and the evidence
-- it leaves behind.
--
-- Two statements `prisma migrate diff` proposed are deliberately absent from
-- this file: `DROP INDEX "Event_languages_gin_idx"` and
-- `DROP INDEX "TicketType_eventId_name_key"`. Both indexes are hand-written in
-- earlier migrations because Prisma's schema language cannot express a GIN index
-- on a text[] or, at the time, that unique index. The generator wants to drop
-- them because the schema does not declare them; dropping them would remove a
-- facet index and a uniqueness guarantee a buyer depends on. The same limitation
-- is why the partial unique index in section 1 below is hand-written.

-- CreateEnum
CREATE TYPE "PrivacyRequestReason" AS ENUM ('SUBJECT_REQUEST', 'ORGANIZER_REQUEST', 'RETENTION_POLICY', 'DATA_MINIMISATION');

-- CreateEnum
CREATE TYPE "PrivacyRequestState" AS ENUM ('REQUESTED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'HELD', 'FAILED_SAFE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrivacyHoldKind" AS ENUM ('LEGAL', 'FRAUD_INVESTIGATION');

-- CreateEnum
CREATE TYPE "PrivacyHoldState" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "PrivacyHoldDecision" AS ENUM ('NOT_EVALUATED', 'NONE_ACTIVE', 'LEGAL_HOLD_ACTIVE', 'FRAUD_HOLD_ACTIVE', 'OPEN_PROCESS');

-- CreateEnum
CREATE TYPE "PrivacyAuditResult" AS ENUM ('REQUESTED', 'CONFIRMED', 'REFUSED_HOLD', 'REFUSED_AUTHORIZATION', 'REFUSED_CONFLICT', 'STARTED', 'COMPLETED', 'FAILED_SAFE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExportArtifactState" AS ENUM ('AVAILABLE', 'INVALIDATED', 'DELETED', 'DELETION_FAILED');

-- CreateEnum
CREATE TYPE "RetentionSweepMode" AS ENUM ('DRY_RUN', 'EXECUTE');

-- CreateEnum
CREATE TYPE "RetentionSweepState" AS ENUM ('SCHEDULED', 'CLAIMED', 'COMPLETED', 'FAILED', 'SKIPPED_DISABLED');

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "state" "PrivacyRequestState" NOT NULL DEFAULT 'REQUESTED',
    "reason" "PrivacyRequestReason" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "confirmationHash" TEXT NOT NULL,
    "confirmationExpiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "policyVersion" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "holdDecision" "PrivacyHoldDecision" NOT NULL DEFAULT 'NOT_EVALUATED',
    "heldByHoldId" TEXT,
    "outcomeCode" TEXT,
    "scope" JSONB,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastAttemptAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyHold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "kind" "PrivacyHoldKind" NOT NULL,
    "state" "PrivacyHoldState" NOT NULL DEFAULT 'ACTIVE',
    "matterReference" TEXT NOT NULL,
    "placedById" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedUntil" TIMESTAMP(3),
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseReasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyAuditEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "organizationId" TEXT NOT NULL,
    "privacyRequestId" TEXT,
    "targetId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "holdDecision" "PrivacyHoldDecision" NOT NULL,
    "idempotencyKeyHash" TEXT,
    "result" "PrivacyAuditResult" NOT NULL,
    "correlationId" TEXT NOT NULL,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportArtifact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT,
    "ephemeral" BOOLEAN NOT NULL DEFAULT true,
    "requestedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" "ExportArtifactState" NOT NULL DEFAULT 'AVAILABLE',
    "invalidatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportArtifactSubject" (
    "id" TEXT NOT NULL,
    "exportArtifactId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportArtifactSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionSweep" (
    "id" TEXT NOT NULL,
    "retentionClass" TEXT NOT NULL,
    "mode" "RetentionSweepMode" NOT NULL,
    "state" "RetentionSweepState" NOT NULL DEFAULT 'SCHEDULED',
    "olderThan" TIMESTAMP(3) NOT NULL,
    "examinedCount" INTEGER NOT NULL DEFAULT 0,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "heldCount" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionSweep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyRequest_idempotencyKey_key" ON "PrivacyRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrivacyRequest_organizationId_state_idx" ON "PrivacyRequest"("organizationId", "state");

-- CreateIndex
CREATE INDEX "PrivacyRequest_subjectUserId_state_idx" ON "PrivacyRequest"("subjectUserId", "state");

-- CreateIndex
CREATE INDEX "PrivacyRequest_state_leaseExpiresAt_idx" ON "PrivacyRequest"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_correlationId_idx" ON "PrivacyRequest"("correlationId");

-- CreateIndex
CREATE INDEX "PrivacyRequest_requestedById_idx" ON "PrivacyRequest"("requestedById");

-- CreateIndex
CREATE INDEX "PrivacyHold_organizationId_subjectUserId_state_idx" ON "PrivacyHold"("organizationId", "subjectUserId", "state");

-- CreateIndex
CREATE INDEX "PrivacyHold_state_kind_idx" ON "PrivacyHold"("state", "kind");

-- CreateIndex
CREATE INDEX "PrivacyHold_subjectUserId_state_idx" ON "PrivacyHold"("subjectUserId", "state");

-- CreateIndex
CREATE INDEX "PrivacyAuditEvent_organizationId_occurredAt_idx" ON "PrivacyAuditEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "PrivacyAuditEvent_privacyRequestId_idx" ON "PrivacyAuditEvent"("privacyRequestId");

-- CreateIndex
CREATE INDEX "PrivacyAuditEvent_targetType_targetId_idx" ON "PrivacyAuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "PrivacyAuditEvent_correlationId_idx" ON "PrivacyAuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "PrivacyAuditEvent_actorId_idx" ON "PrivacyAuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "PrivacyAuditEvent_result_occurredAt_idx" ON "PrivacyAuditEvent"("result", "occurredAt");

-- CreateIndex
CREATE INDEX "PrivacyAuditEvent_action_occurredAt_idx" ON "PrivacyAuditEvent"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "ExportArtifact_organizationId_state_idx" ON "ExportArtifact"("organizationId", "state");

-- CreateIndex
CREATE INDEX "ExportArtifact_state_generatedAt_idx" ON "ExportArtifact"("state", "generatedAt");

-- CreateIndex
CREATE INDEX "ExportArtifactSubject_subjectUserId_idx" ON "ExportArtifactSubject"("subjectUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportArtifactSubject_exportArtifactId_subjectUserId_key" ON "ExportArtifactSubject"("exportArtifactId", "subjectUserId");

-- CreateIndex
CREATE INDEX "RetentionSweep_retentionClass_state_idx" ON "RetentionSweep"("retentionClass", "state");

-- CreateIndex
CREATE INDEX "RetentionSweep_state_leaseExpiresAt_idx" ON "RetentionSweep"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "RetentionSweep_createdAt_idx" ON "RetentionSweep"("createdAt");

-- AddForeignKey
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyHold" ADD CONSTRAINT "PrivacyHold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyHold" ADD CONSTRAINT "PrivacyHold_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyHold" ADD CONSTRAINT "PrivacyHold_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyHold" ADD CONSTRAINT "PrivacyHold_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportArtifact" ADD CONSTRAINT "ExportArtifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportArtifact" ADD CONSTRAINT "ExportArtifact_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportArtifactSubject" ADD CONSTRAINT "ExportArtifactSubject_exportArtifactId_fkey" FOREIGN KEY ("exportArtifactId") REFERENCES "ExportArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportArtifactSubject" ADD CONSTRAINT "ExportArtifactSubject_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 1. One redaction in flight at a time, per subject and organisation
--
-- Two operators reading the same screen and both confirming would otherwise
-- start two redactions of one person. The second would find placeholders where
-- it expected values, and whether that is a success or a failure is not a
-- question the service should have to answer.
--
-- Partial, because a terminal request must not block the next one: a subject
-- whose redaction was HELD may be redacted once the hold is released, and a
-- FAILED_SAFE request may be superseded. Prisma's schema language cannot
-- express a partial unique index, so it is written here.
-- ===========================================================================

CREATE UNIQUE INDEX "PrivacyRequest_one_in_flight_per_subject_key"
  ON "PrivacyRequest" ("organizationId", "subjectUserId")
  WHERE "state" IN ('REQUESTED', 'QUEUED', 'PROCESSING');

-- ===========================================================================
-- 2. What a redaction request may say about itself
--
-- The application decides whether a redaction may proceed. These are the
-- statements that must still hold when somebody writes a new code path next
-- year and forgets — chiefly that nothing executes without a hold evaluation
-- that came back clear, and that a terminal request always says what happened.
-- ===========================================================================

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_confirmation_after_creation"
  CHECK ("confirmationExpiresAt" > "createdAt");

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_confirmed_within_window"
  CHECK ("confirmedAt" IS NULL OR "confirmedAt" <= "confirmationExpiresAt");

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_lease_has_owner"
  CHECK (("leaseOwner" IS NULL) = ("leaseExpiresAt" IS NULL));

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_attempts_sane"
  CHECK ("attempts" >= 0 AND "maxAttempts" > 0);

-- A terminal state without an outcome code is a record that says something
-- happened and refuses to say what.
ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_terminal_has_outcome"
  CHECK (
    "state" NOT IN ('COMPLETED', 'HELD', 'FAILED_SAFE', 'CANCELLED')
    OR "outcomeCode" IS NOT NULL
  );

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_completed_has_timestamp"
  CHECK ("state" <> 'COMPLETED' OR "completedAt" IS NOT NULL);

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_cancelled_has_timestamp"
  CHECK ("state" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL);

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_held_names_its_hold"
  CHECK ("state" <> 'HELD' OR "heldByHoldId" IS NOT NULL);

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_started_before_processing"
  CHECK ("state" NOT IN ('PROCESSING', 'COMPLETED') OR "startedAt" IS NOT NULL);

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_confirmed_before_queued"
  CHECK (
    "state" NOT IN ('QUEUED', 'PROCESSING', 'COMPLETED')
    OR "confirmedAt" IS NOT NULL
  );

-- The floor under the whole workstream: a request cannot be queued, processing
-- or completed unless the hold evaluation ran and came back clear. A
-- NOT_EVALUATED request that reached execution would be a redaction performed
-- without asking whether it was allowed.
ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "privacy_request_executes_only_when_clear"
  CHECK (
    "state" NOT IN ('QUEUED', 'PROCESSING', 'COMPLETED')
    OR "holdDecision" = 'NONE_ACTIVE'
  );

-- ===========================================================================
-- 3. A hold either is in force or records who lifted it
-- ===========================================================================

ALTER TABLE "PrivacyHold"
  ADD CONSTRAINT "privacy_hold_release_coherent"
  CHECK (("state" = 'RELEASED') = ("releasedAt" IS NOT NULL));

ALTER TABLE "PrivacyHold"
  ADD CONSTRAINT "privacy_hold_release_names_an_actor"
  CHECK (("releasedAt" IS NULL) = ("releasedById" IS NULL));

ALTER TABLE "PrivacyHold"
  ADD CONSTRAINT "privacy_hold_released_after_placed"
  CHECK ("releasedAt" IS NULL OR "releasedAt" >= "placedAt");

-- A hold with no reference to the matter outside this system is a hold nobody
-- can resolve, and it would block a person's redaction indefinitely.
ALTER TABLE "PrivacyHold"
  ADD CONSTRAINT "privacy_hold_names_its_matter"
  CHECK (length(btrim("matterReference")) > 0);

-- ===========================================================================
-- 4. Export artefacts say plainly whether the bytes are gone
--
-- DELETION_FAILED exists so that a failed deletion is never reported as a
-- deletion. It is the one state in this table that waits for a human.
-- ===========================================================================

ALTER TABLE "ExportArtifact"
  ADD CONSTRAINT "export_artifact_invalidated_has_timestamp"
  CHECK ("state" NOT IN ('INVALIDATED', 'DELETED') OR "invalidatedAt" IS NOT NULL);

ALTER TABLE "ExportArtifact"
  ADD CONSTRAINT "export_artifact_deleted_has_timestamp"
  CHECK ("state" <> 'DELETED' OR "deletedAt" IS NOT NULL);

ALTER TABLE "ExportArtifact"
  ADD CONSTRAINT "export_artifact_failure_has_code"
  CHECK ("state" <> 'DELETION_FAILED' OR "failureCode" IS NOT NULL);

-- An artefact nothing stored has nothing to delete, so it must not claim a
-- storage key; one that stored bytes must say where they are or deletion has
-- no target.
ALTER TABLE "ExportArtifact"
  ADD CONSTRAINT "export_artifact_storage_matches_ephemerality"
  CHECK ("ephemeral" = ("storageKey" IS NULL));

-- ===========================================================================
-- 5. A retention sweep cannot claim a dry run changed something
--
-- The default posture is DRY_RUN, because every duration the sweeper would
-- apply is a proposal awaiting legal review rather than settled policy. This is
-- the constraint that makes "it was only a rehearsal" checkable afterwards
-- rather than a claim in a log line.
-- ===========================================================================

ALTER TABLE "RetentionSweep"
  ADD CONSTRAINT "retention_sweep_dry_run_changes_nothing"
  CHECK ("mode" <> 'DRY_RUN' OR "affectedCount" = 0);

ALTER TABLE "RetentionSweep"
  ADD CONSTRAINT "retention_sweep_counts_non_negative"
  CHECK ("examinedCount" >= 0 AND "affectedCount" >= 0 AND "heldCount" >= 0);

ALTER TABLE "RetentionSweep"
  ADD CONSTRAINT "retention_sweep_affected_within_examined"
  CHECK ("affectedCount" <= "examinedCount");

ALTER TABLE "RetentionSweep"
  ADD CONSTRAINT "retention_sweep_lease_has_owner"
  CHECK (("leaseOwner" IS NULL) = ("leaseExpiresAt" IS NULL));

ALTER TABLE "RetentionSweep"
  ADD CONSTRAINT "retention_sweep_finished_after_start"
  CHECK ("finishedAt" IS NULL OR ("startedAt" IS NOT NULL AND "finishedAt" >= "startedAt"));

ALTER TABLE "RetentionSweep"
  ADD CONSTRAINT "retention_sweep_failure_has_code"
  CHECK ("state" <> 'FAILED' OR "failureCode" IS NOT NULL);

-- ===========================================================================
-- 6. A redaction request moves forward, and never changes what it is about
--
-- Two rules in one trigger, because both are about the same mistake: a request
-- that becomes a different request. The identity columns — which organisation,
-- which person, which idempotency key, which confirmation, which policy —
-- cannot be rewritten after the row exists, or an audit trail assembled by
-- correlation id would describe a request that no longer matches the one that
-- ran. And the state machine only goes one way: a terminal request is finished,
-- and "retry" means a new request rather than a resurrection.
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_privacy_request_state_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId"
     OR NEW."subjectUserId" <> OLD."subjectUserId"
     OR NEW."requestedById" <> OLD."requestedById"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."correlationId" <> OLD."correlationId"
     OR NEW."policyVersion" <> OLD."policyVersion"
     OR NEW."confirmationHash" <> OLD."confirmationHash" THEN
    RAISE EXCEPTION 'privacy request % cannot change what it is about', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."state" = OLD."state" THEN
    RETURN NEW;
  END IF;

  IF OLD."state" IN ('COMPLETED', 'HELD', 'FAILED_SAFE', 'CANCELLED') THEN
    RAISE EXCEPTION 'privacy request % is %; it cannot move to %',
      OLD."id", OLD."state", NEW."state"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."state" = 'REQUESTED'
     AND NEW."state" NOT IN ('QUEUED', 'HELD', 'FAILED_SAFE', 'CANCELLED') THEN
    RAISE EXCEPTION 'privacy request % cannot move from REQUESTED to %',
      OLD."id", NEW."state"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."state" = 'QUEUED'
     AND NEW."state" NOT IN ('PROCESSING', 'HELD', 'FAILED_SAFE', 'CANCELLED') THEN
    RAISE EXCEPTION 'privacy request % cannot move from QUEUED to %',
      OLD."id", NEW."state"
      USING ERRCODE = 'check_violation';
  END IF;

  -- Once personal data may already have been replaced, the only honest answers
  -- are "it finished" and "it stopped safely". CANCELLED would claim nothing
  -- happened, and HELD would claim it was never allowed to start.
  IF OLD."state" = 'PROCESSING'
     AND NEW."state" NOT IN ('COMPLETED', 'FAILED_SAFE') THEN
    RAISE EXCEPTION 'privacy request % is already processing; it cannot move to %',
      OLD."id", NEW."state"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_privacy_request_state_transition
  BEFORE UPDATE ON "PrivacyRequest"
  FOR EACH ROW EXECUTE FUNCTION desi_privacy_request_state_transition();

-- ===========================================================================
-- 7. Privacy evidence is append-only, and the database says so
--
-- An irreversible action's evidence has to be immutable as a property of the
-- database rather than as a convention about which functions exist. Every column
-- on this table is an opaque id, an enum, a hash or a count, so there is
-- nothing here a redaction would ever need to reach — which is what makes
-- absolute immutability the correct rule rather than an inconvenient one.
--
-- The rule is unconditional on purpose. The ledger's equivalent is conditional
-- (a batch is editable while DRAFT and frozen once POSTED) because a batch is
-- assembled before it is posted. An audit event is final the instant it is
-- written, so there is no earlier state to allow.
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_privacy_audit_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'privacy audit events are append-only; % on % is refused',
    TG_OP, COALESCE(OLD."id", NEW."id")
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER desi_privacy_audit_event_immutable
  BEFORE UPDATE OR DELETE ON "PrivacyAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION desi_privacy_audit_event_immutable();

-- ===========================================================================
-- 8. The audit log stops being unprunable by convention
--
-- `docs/DATA_MODEL.md` has said since Phase 2 that the value of AuditLog is
-- that it cannot be pruned selectively. Until now nothing enforced it: no
-- trigger, no constraint, no revoked grant. A redaction implementation could
-- have rewritten history with no failure and no trace, which is exactly the
-- power an auditable redaction must not have.
--
-- The rule has a consequence worth stating rather than discovering. AuditLog's
-- actor foreign key is ON DELETE SET NULL, so deleting a `User` row is an
-- UPDATE of every audit row that person produced — and that UPDATE is now
-- refused. A user with audit history therefore cannot be deleted at all.
--
-- That is the intended design and not a side effect: erasure in this system is
-- redaction, the `User` row survives it, and no route has ever deleted a user.
-- What it does change is test and seed teardown, which previously deleted
-- fixture users; those are reworked to leave them, the way a published venue map
-- version is already deliberately left in place.
--
-- Existing rows are retained unchanged, which is the authorised rule. The
-- personal data already inside `AuditLog.metadata` — e-mail addresses written by
-- the ticket-transfer, checkout and invitation paths — therefore cannot be
-- redacted in place. That tension is recorded in `docs/PRIVACY_AND_RETENTION.md`
-- as an owner decision rather than resolved here by rewriting history.
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit rows are append-only; % on % is refused',
    TG_OP, COALESCE(OLD."id", NEW."id")
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER desi_audit_log_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION desi_audit_log_immutable();
