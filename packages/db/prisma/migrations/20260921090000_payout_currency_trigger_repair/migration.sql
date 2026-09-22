-- Repair `desi_payout_currency_matches`, which has never once run its comparison.
--
-- The function was installed by `20260916130000_commerce_services` reading a
-- column called `"payoutCurrency"` from `"ConnectedAccount"`. That column does
-- not exist and never did: the currency a connected account declares is
-- `"defaultCurrency"`. plpgsql plans a function body when the function runs
-- rather than when it is created, so the wrong name installed without complaint
-- and surfaced only when the trigger fired.
--
-- The effect was worse than a guard that does not guard. The trigger is
-- `BEFORE INSERT OR UPDATE ON "Payout"`, and the bad SELECT sits after the
-- early return for a null account, so:
--
--   * a payout with `"connectedAccountId"` NULL was accepted, having skipped
--     the SELECT entirely, and
--   * a payout naming any connected account was refused outright with SQLSTATE
--     42703 (`column "payoutCurrency" does not exist`), whatever its currency.
--
-- No existing row can be in breach of the repaired rule, because no row naming
-- a connected account could ever be written while the broken body was in place.
-- That is why this migration needs no backfill and no data repair.
--
-- The repair is the column name and nothing else. The null-account skip, the
-- null-currency skip, and the strict inequality are all carried over unchanged
-- from the original body: this migration fixes a defect, it does not decide new
-- currency policy. Two things follow from that deliberately narrow scope and
-- are recorded here rather than silently changed:
--
--   * `"ConnectedAccount"."defaultCurrency"` is nullable, and a NULL still
--     means "this account declares no currency, so there is nothing to compare
--     against". That is the original intent, not a new exemption.
--   * The comparison is byte-for-byte. Neither `"Payout"."currency"` nor
--     `"ConnectedAccount"."defaultCurrency"` carries an alpha-3 CHECK the way
--     `"LedgerEntry"."currency"` does, so a row written as `inr` would not
--     match one written as `INR`. Normalising them is a policy change and a
--     schema change; it is not part of repairing this trigger.
--
-- `CREATE OR REPLACE FUNCTION` keeps the function's identity, so the existing
-- `desi_payout_currency_matches` trigger on `"Payout"` picks the new body up
-- without being dropped and recreated.
CREATE OR REPLACE FUNCTION desi_payout_currency_matches() RETURNS trigger AS $$
DECLARE
  account_currency TEXT;
BEGIN
  IF NEW."connectedAccountId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "defaultCurrency" INTO account_currency
    FROM "ConnectedAccount" WHERE "id" = NEW."connectedAccountId";

  IF account_currency IS NOT NULL AND account_currency <> NEW."currency" THEN
    RAISE EXCEPTION 'payout % is in %, but its connected account declares %',
      NEW."id", NEW."currency", account_currency;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
