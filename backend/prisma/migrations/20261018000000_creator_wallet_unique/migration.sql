-- A creator profile's payout wallet must be unique (#276). Donations and the
-- goal-update reconciliation are keyed by wallet address, so two profiles
-- sharing one let a squatter intercept another creator's activity.
--
-- The index is partial: "" means "no wallet connected yet" (magic-link/OAuth
-- accounts) and many profiles may legitimately have that.
--
-- Existing duplicates cannot be resolved automatically (we cannot tell which
-- profile really owns the wallet), so the migration lists them and stops.
-- Resolve them (clear the walletAddress of the squatting profiles, or merge
-- accounts) and re-run `prisma migrate deploy`.
DO $$
DECLARE
  dup RECORD;
  report TEXT := '';
BEGIN
  FOR dup IN
    SELECT "walletAddress",
           COUNT(*) AS profiles,
           string_agg(username || ' (id ' || id || ')', ', ' ORDER BY id) AS usernames
    FROM "Creator"
    WHERE "walletAddress" <> ''
    GROUP BY "walletAddress"
    HAVING COUNT(*) > 1
    ORDER BY "walletAddress"
  LOOP
    report := report || E'\n  ' || dup."walletAddress" || ' -> ' || dup.usernames;
  END LOOP;

  IF report <> '' THEN
    RAISE EXCEPTION E'Cannot enforce unique Creator.walletAddress: these wallets are shared by several profiles:%\nResolve the duplicates, then re-run the migration.', report;
  END IF;
END $$;

CREATE UNIQUE INDEX "Creator_walletAddress_key"
  ON "Creator" ("walletAddress")
  WHERE "walletAddress" <> '';
