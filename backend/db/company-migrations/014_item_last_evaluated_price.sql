-- SAP B1 OITM "Last Evaluated Price" (Item Master > Inventory Data). The Goods
-- Receipt / Goods Issue / Inventory Transfer (Request) item lists read it; without
-- the column their item query failed and the item list came back empty.
ALTER TABLE "OITM"
  ADD COLUMN IF NOT EXISTS "LstEvlPric" NUMERIC(19,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "LstEvlDate" DATE;
