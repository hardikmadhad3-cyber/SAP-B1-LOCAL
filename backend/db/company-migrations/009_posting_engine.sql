-- Phase 4 posting engine: accounts the journal needs and indexes for copy-from
-- and committed/ordered recalculation.

-- Freight (SDK OEXD): revenue account for sales, expense account for purchasing.
ALTER TABLE "OEXD"
  ADD "RevAcct" TEXT REFERENCES "OACT"("AcctCode"),
  ADD "ExpnsAcct" TEXT REFERENCES "OACT"("AcctCode");

-- Rounding account for document rounding differences (G/L account determination).
ALTER TABLE "OACP" ADD "RoundAcct" TEXT REFERENCES "OACT"("AcctCode");

-- Copy-from: target rows are found by their base row; order rows by item/warehouse.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['QUT1','RDR1','DLN1','INV1','RIN1','POR1','PDN1','PCH1','RPC1','PRQ1','PQT1'] LOOP
    EXECUTE format('CREATE INDEX %I ON %I ("BaseType", "BaseEntry", "BaseLine")', 'IX_' || table_name || '_Base', table_name);
  END LOOP;
END $$;
CREATE INDEX "IX_RDR1_ItemWhs" ON "RDR1" ("ItemCode", "WhsCode");
CREATE INDEX "IX_POR1_ItemWhs" ON "POR1" ("ItemCode", "WhsCode");
CREATE INDEX "IX_OINM_Document" ON "OINM" ("TransType", "CreatedBy");
