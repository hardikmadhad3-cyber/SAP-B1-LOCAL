-- Business partners (SDK OCRD / CRD1 / OCPR). Columns cover what the
-- transaction readers query; everything else the BP page sends is kept in
-- "SlExtra" (JSON) and returned with the BP, so nothing it saves is lost.

ALTER TABLE "OCRD"
  ADD "CardFName" TEXT, ADD "Notes" TEXT, ADD "Free_Text" TEXT, ADD "IntrntSite" TEXT,
  ADD "Discount" NUMERIC(19,6) NOT NULL DEFAULT 0, ADD "IntrstRate" NUMERIC(19,6) NOT NULL DEFAULT 0,
  ADD "DpmClear" TEXT REFERENCES "OACT"("AcctCode"), ADD "DpmIntAct" TEXT REFERENCES "OACT"("AcctCode"),
  ADD "validFrom" DATE, ADD "validTo" DATE, ADD "frozenFrom" DATE, ADD "frozenTo" DATE,
  ADD "WTLiable" CHAR(1) NOT NULL DEFAULT 'N', ADD "WTCode" TEXT,
  ADD "ProjectCod" TEXT, ADD "Territory" INTEGER, ADD "ConnBP" TEXT REFERENCES "OCRD"("CardCode"),
  ADD "FatherCard" TEXT REFERENCES "OCRD"("CardCode"), ADD "ShipType" INTEGER, ADD "LangCode" INTEGER,
  ADD "Indicator" TEXT, ADD "Priority" INTEGER,
  -- Default bill-to (Address/City/ZipCode/State1/Country exist) and ship-to copies, as SAP keeps them.
  ADD "County" TEXT, ADD "MailCity" TEXT, ADD "MailZipCod" TEXT, ADD "MailCounty" TEXT, ADD "State2" TEXT,
  ADD "MailCountr" TEXT, ADD "UpdateDate" DATE, ADD "SlExtra" JSONB;
ALTER TABLE "OCRD" ALTER COLUMN "VatGroup" DROP DEFAULT;
ALTER TABLE "OCRD"
  ADD CONSTRAINT "CK_OCRD_Code" CHECK (char_length("CardCode") BETWEEN 1 AND 15),
  ADD CONSTRAINT "CK_OCRD_Name" CHECK (char_length("CardName") BETWEEN 1 AND 100),
  ADD CONSTRAINT "FK_OCRD_PayTerms" FOREIGN KEY ("GroupNum") REFERENCES "OCTG"("GroupNum"),
  ADD CONSTRAINT "FK_OCRD_PriceList" FOREIGN KEY ("ListNum") REFERENCES "OPLN"("ListNum"),
  ADD CONSTRAINT "FK_OCRD_SalesPerson" FOREIGN KEY ("SlpCode") REFERENCES "OSLP"("SlpCode"),
  ADD CONSTRAINT "FK_OCRD_ControlAcct" FOREIGN KEY ("DebPayAcct") REFERENCES "OACT"("AcctCode"),
  ADD CONSTRAINT "FK_OCRD_Series" FOREIGN KEY ("Series") REFERENCES "NNM1"("Series");

-- Addresses: SAP keys them by BP, name and type (B bill-to, S ship-to).
ALTER TABLE "CRD1" ADD "SlExtra" JSONB;
ALTER TABLE "CRD1" DROP CONSTRAINT "CRD1_CardCode_fkey";
ALTER TABLE "CRD1"
  ADD CONSTRAINT "CRD1_CardCode_fkey" FOREIGN KEY ("CardCode") REFERENCES "OCRD"("CardCode") ON DELETE CASCADE,
  ADD CONSTRAINT "UQ_CRD1_Address" UNIQUE ("CardCode", "Address", "AdresType"),
  ADD CONSTRAINT "CK_CRD1_Type" CHECK ("AdresType" IN ('B', 'S'));

-- Contact persons.
ALTER TABLE "OCPR" ADD "Position" TEXT, ADD "SlExtra" JSONB;
ALTER TABLE "OCPR" DROP CONSTRAINT "OCPR_CardCode_fkey";
ALTER TABLE "OCPR"
  ADD CONSTRAINT "OCPR_CardCode_fkey" FOREIGN KEY ("CardCode") REFERENCES "OCRD"("CardCode") ON DELETE CASCADE,
  ADD CONSTRAINT "UQ_OCPR_Name" UNIQUE ("CardCode", "Name");

-- BP numbering is per BP type in SAP (NNM1.DocSubType C = customers/leads,
-- S = vendors). Companies seeded with a single "--" series get both, with
-- C/V prefixes so customer and vendor codes never collide.
UPDATE "NNM1" SET "DocSubType" = 'C', "SeriesName" = 'Customers',
  "BeginStr" = CASE WHEN COALESCE("BeginStr", '') = '' THEN 'C' ELSE "BeginStr" END
WHERE "ObjectCode" = '2' AND "DocSubType" = '--';
UPDATE "ONNM" SET "DocSubType" = 'C' WHERE "ObjectCode" = '2' AND "DocSubType" = '--';
INSERT INTO "NNM1" ("SeriesName", "ObjectCode", "Indicator", "DocSubType", "BeginStr")
SELECT 'Vendors', '2', "Indicator", 'S', 'V' FROM "NNM1"
WHERE "ObjectCode" = '2' AND "DocSubType" = 'C'
  AND NOT EXISTS (SELECT 1 FROM "NNM1" WHERE "ObjectCode" = '2' AND "DocSubType" = 'S')
LIMIT 1;
INSERT INTO "ONNM" ("ObjectCode", "DocSubType", "DfltSeries", "DfltSerie")
SELECT '2', 'S', MIN("Series"), MIN("Series") FROM "NNM1" WHERE "ObjectCode" = '2' AND "DocSubType" = 'S'
HAVING MIN("Series") IS NOT NULL
ON CONFLICT DO NOTHING;
