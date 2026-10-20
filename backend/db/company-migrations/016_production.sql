-- Production (BOM, production orders, issue/receipt for production) in the
-- local ERP: the SAP B1 columns the production pages read and write.

-- Bill of materials header (OITT) and rows (ITT1).
ALTER TABLE "OITT"
  ADD COLUMN IF NOT EXISTS "PlAvgSize" NUMERIC(19,6) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "OcrCode" TEXT,
  ADD COLUMN IF NOT EXISTS "Project" TEXT,
  ADD COLUMN IF NOT EXISTS "HideComp" CHAR(1) DEFAULT 'N';
ALTER TABLE "ITT1"
  ADD COLUMN IF NOT EXISTS "PriceList" INTEGER,
  ADD COLUMN IF NOT EXISTS "OcrCode" TEXT,
  ADD COLUMN IF NOT EXISTS "Project" TEXT,
  ADD COLUMN IF NOT EXISTS "WipActCode" TEXT,
  ADD COLUMN IF NOT EXISTS "AddQuant" NUMERIC(19,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "StageId" INTEGER,
  ADD COLUMN IF NOT EXISTS "VisOrder" INTEGER,
  ADD COLUMN IF NOT EXISTS "LineText" TEXT;

ALTER TABLE "OWOR" ADD COLUMN IF NOT EXISTS "Priority" INTEGER DEFAULT 100;
ALTER TABLE "ORSC" ADD COLUMN IF NOT EXISTS "DfltWH" TEXT;

-- Issue / receipt rows keep the production order number (BaseRef); a receipt
-- row is a completed or a rejected quantity (TranType C / R).
ALTER TABLE "IGE1" ADD COLUMN IF NOT EXISTS "BaseRef" TEXT;
ALTER TABLE "IGN1" ADD COLUMN IF NOT EXISTS "BaseRef" TEXT, ADD COLUMN IF NOT EXISTS "TranType" CHAR(1);

-- Receiving bin settings read by Receipt from Production.
ALTER TABLE "OWHS"
  ADD COLUMN IF NOT EXISTS "RecBinEnab" CHAR(1) DEFAULT 'N',
  ADD COLUMN IF NOT EXISTS "DftBinAbs" INTEGER,
  ADD COLUMN IF NOT EXISTS "AutoRecvMd" INTEGER DEFAULT 0;
