-- Phase 4 inventory documents: Goods Receipt (OIGN), Goods Issue (OIGE),
-- Inventory Transfer (OWTR) and Inventory Transfer Request (OWTQ).

-- SDK OACP: Inventory Offset - Decrease / Increase accounts (G/L Account
-- Determination), the fallback after the warehouse and item group accounts.
-- Existing companies start from their default expense account.
ALTER TABLE "OACP"
  ADD COLUMN IF NOT EXISTS "DecreasAc" TEXT REFERENCES "OACT"("AcctCode"),
  ADD COLUMN IF NOT EXISTS "IncreasAc" TEXT REFERENCES "OACT"("AcctCode");
UPDATE "OACP" SET "DecreasAc" = COALESCE("DecreasAc", "DfltExpn"), "IncreasAc" = COALESCE("IncreasAc", "DfltExpn");

-- SDK header references the inventory pages read and send (Ref2).
ALTER TABLE "OIGN" ADD COLUMN IF NOT EXISTS "Ref1" TEXT, ADD COLUMN IF NOT EXISTS "Ref2" TEXT;
ALTER TABLE "OIGE" ADD COLUMN IF NOT EXISTS "Ref1" TEXT, ADD COLUMN IF NOT EXISTS "Ref2" TEXT;
ALTER TABLE "OWTR" ADD COLUMN IF NOT EXISTS "Ref1" TEXT, ADD COLUMN IF NOT EXISTS "Ref2" TEXT;
ALTER TABLE "OWTQ" ADD COLUMN IF NOT EXISTS "Ref1" TEXT, ADD COLUMN IF NOT EXISTS "Ref2" TEXT;

-- Transfer from a transfer request: target rows are found by their base row.
CREATE INDEX IF NOT EXISTS "IX_WTR1_Base" ON "WTR1" ("BaseType", "BaseEntry", "BaseLine");
