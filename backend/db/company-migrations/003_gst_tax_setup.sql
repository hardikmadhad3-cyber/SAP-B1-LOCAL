-- India GST tax setup on SAP B1's own tables (SDK 10.0 references: OSTT, OSTA,
-- OSTC, STC1). Transaction readers identify GST components by the SAP system
-- tax types -100 CGST, -110 SGST, -120 IGST and read rates from STC1.EfctivRate.

-- Tax types (Sales Tax Authorities Type).
CREATE TABLE "OSTT" (
  "AbsId" INTEGER PRIMARY KEY,
  "Name" TEXT NOT NULL UNIQUE CHECK (char_length("Name") BETWEEN 1 AND 40),
  "IsVat" CHAR(1) NOT NULL DEFAULT 'N' CHECK ("IsVat" IN ('Y','N')),
  "Locked" CHAR(1) NOT NULL DEFAULT 'N' CHECK ("Locked" IN ('Y','N')),
  "UpdateDate" DATE
);
-- ponytail: only the three types the transaction readers sum; add UTGST/Cess with the readers when needed.
INSERT INTO "OSTT" ("AbsId", "Name") VALUES (-100, 'CGST'), (-110, 'SGST'), (-120, 'IGST');

-- Tax components (Sales Tax Authorities): SAP keys them by Code alone.
ALTER TABLE "OSTA"
  ADD "UseTax" TEXT REFERENCES "OACT"("AcctCode"),
  ADD "deferrAcct" TEXT REFERENCES "OACT"("AcctCode"),
  ADD "NonDdctPrc" NUMERIC(19,6) NOT NULL DEFAULT 0,
  ADD "NonDdctAct" TEXT REFERENCES "OACT"("AcctCode"),
  ADD "TaxInPrice" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "Exempt" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "EfctDate" DATE,
  ADD "IsSystem" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "RvsCrgPrc" NUMERIC(19,6) NOT NULL DEFAULT 0,
  ADD "SaleTaxRCM" TEXT REFERENCES "OACT"("AcctCode"),
  ADD "SaleRCMClr" TEXT REFERENCES "OACT"("AcctCode"),
  ADD "UpdateDate" DATE,
  ADD CONSTRAINT "UQ_OSTA_Code" UNIQUE ("Code"),
  ADD CONSTRAINT "FK_OSTA_Type" FOREIGN KEY ("Type") REFERENCES "OSTT"("AbsId"),
  ADD CONSTRAINT "FK_OSTA_SalesTax" FOREIGN KEY ("SalesTax") REFERENCES "OACT"("AcctCode"),
  ADD CONSTRAINT "FK_OSTA_PurchTax" FOREIGN KEY ("PurchTax") REFERENCES "OACT"("AcctCode"),
  ADD CONSTRAINT "CK_OSTA_Code" CHECK (char_length("Code") BETWEEN 1 AND 8),
  ADD CONSTRAINT "CK_OSTA_Rate" CHECK ("Rate" >= 0 AND "Rate" <= 100 AND "NonDdctPrc" BETWEEN 0 AND 100 AND "RvsCrgPrc" BETWEEN 0 AND 100);
ALTER TABLE "OSTA" ALTER COLUMN "Rate" SET DEFAULT 0, ALTER COLUMN "Rate" SET NOT NULL, ALTER COLUMN "Name" SET NOT NULL;

-- Tax codes (Sales Tax Codes): total rate and A/R / A/P validity.
ALTER TABLE "OSTC"
  ADD "Rate" NUMERIC(19,6) NOT NULL DEFAULT 0,
  ADD "Freight" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "ValidForAR" CHAR(1) NOT NULL DEFAULT 'Y',
  ADD "ValidForAP" CHAR(1) NOT NULL DEFAULT 'Y',
  ADD "IsItmLevel" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "IsSystem" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "EfctDate" DATE,
  ADD "UpdateDate" DATE,
  ADD CONSTRAINT "CK_OSTC_Code" CHECK (char_length("Code") BETWEEN 1 AND 8),
  ADD CONSTRAINT "CK_OSTC_Flags" CHECK ("Lock" IN ('Y','N') AND "Freight" IN ('Y','N')
    AND "ValidForAR" IN ('Y','N') AND "ValidForAP" IN ('Y','N'));
ALTER TABLE "OSTC" ALTER COLUMN "Name" SET NOT NULL, ALTER COLUMN "Lock" SET NOT NULL;

-- Tax code rows: SAP calls the row number Line_ID (the journal reader orders by it).
ALTER TABLE "STC1" RENAME COLUMN "LineNum" TO "Line_ID";
ALTER TABLE "STC1"
  ADD CONSTRAINT "FK_STC1_Authority" FOREIGN KEY ("STACode") REFERENCES "OSTA"("Code"),
  ADD CONSTRAINT "UQ_STC1_Component" UNIQUE ("STCCode", "STACode");
ALTER TABLE "STC1" ALTER COLUMN "EfctivRate" SET NOT NULL;

-- Existing rows: effective rate from the component, code rate = sum of rows.
UPDATE "STC1" s SET "EfctivRate" = a."Rate" FROM "OSTA" a WHERE a."Code" = s."STACode";
UPDATE "OSTC" c SET "Rate" = COALESCE((SELECT SUM("EfctivRate") FROM "STC1" s WHERE s."STCCode" = c."Code"), 0);
