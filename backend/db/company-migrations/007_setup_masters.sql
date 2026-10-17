-- Setup masters to the SAP B1 10.0 SDK definitions: units of measure (OUOM),
-- UoM groups (OUGP/UGP1), payment terms (OCTG/CTG1), price lists (OPLN),
-- shipping types (OSHP), branches (OBPL) and the chart of accounts (OACT).

-- Units of measure and UoM groups.
ALTER TABLE "OUOM" ADD CONSTRAINT "CK_OUOM_Sizes" CHECK (char_length("UomCode") BETWEEN 1 AND 20 AND char_length("UomName") BETWEEN 1 AND 100);
ALTER TABLE "OUGP" ADD CONSTRAINT "CK_OUGP_Sizes" CHECK (char_length("UgpCode") BETWEEN 1 AND 20 AND char_length(COALESCE("UgpName", '')) <= 100);
ALTER TABLE "UGP1" ADD "IsActive" CHAR(1) NOT NULL DEFAULT 'Y',
  ADD CONSTRAINT "CK_UGP1_Qty" CHECK ("AltQty" > 0 AND "BaseQty" > 0),
  ADD CONSTRAINT "UQ_UGP1_Uom" UNIQUE ("UgpEntry", "UomEntry");
ALTER TABLE "UGP1" DROP CONSTRAINT "UGP1_UgpEntry_fkey";
ALTER TABLE "UGP1" ADD CONSTRAINT "UGP1_UgpEntry_fkey" FOREIGN KEY ("UgpEntry") REFERENCES "OUGP"("UgpEntry") ON DELETE CASCADE;

-- Payment terms: SDK "Start From" (PayDuMonth), total discount, discount code as text.
ALTER TABLE "OCTG"
  ADD "PayDuMonth" CHAR(1) NOT NULL DEFAULT 'N', ADD "VolumDscnt" NUMERIC(19,6) NOT NULL DEFAULT 0,
  ADD "LatePyChrg" NUMERIC(19,6) NOT NULL DEFAULT 0, ADD "ObligLimit" NUMERIC(19,6) NOT NULL DEFAULT 0;
ALTER TABLE "OCTG" ALTER COLUMN "DiscCode" TYPE TEXT USING "DiscCode"::text;
ALTER TABLE "OCTG"
  ADD CONSTRAINT "UQ_OCTG_Name" UNIQUE ("PymntGroup"),
  ADD CONSTRAINT "CK_OCTG_Codes" CHECK ("BslineDate" IN ('P', 'S', 'T', 'C') AND "PayDuMonth" IN ('E', 'H', 'Y', 'N')),
  ADD CONSTRAINT "FK_OCTG_PriceList" FOREIGN KEY ("ListNum") REFERENCES "OPLN"("ListNum");
ALTER TABLE "CTG1"
  ADD CONSTRAINT "PK_CTG1" PRIMARY KEY ("CTGCode", "IntsNo"),
  ADD CONSTRAINT "FK_CTG1_Terms" FOREIGN KEY ("CTGCode") REFERENCES "OCTG"("GroupNum") ON DELETE CASCADE,
  ADD CONSTRAINT "CK_CTG1_Percent" CHECK ("InstPrcnt" > 0 AND "InstPrcnt" <= 100);

-- Price lists.
ALTER TABLE "OPLN"
  ADD "ValidFrom" DATE, ADD "ValidTo" DATE, ADD "AddCurr1" TEXT, ADD "AddCurr2" TEXT,
  ADD "RoundRule" CHAR(1) NOT NULL DEFAULT 'R', ADD "GroupCode" INTEGER NOT NULL DEFAULT 1,
  ADD "CreateDate" DATE DEFAULT CURRENT_DATE, ADD "UpdateDate" DATE;
ALTER TABLE "OPLN"
  ADD CONSTRAINT "UQ_OPLN_Name" UNIQUE ("ListName"),
  ADD CONSTRAINT "CK_OPLN_Name" CHECK (char_length("ListName") BETWEEN 1 AND 32),
  ADD CONSTRAINT "CK_OPLN_Factor" CHECK ("Factor" IS NULL OR "Factor" > 0),
  ADD CONSTRAINT "FK_OPLN_Base" FOREIGN KEY ("BASE_NUM") REFERENCES "OPLN"("ListNum");

-- Shipping types.
ALTER TABLE "OSHP"
  ADD CONSTRAINT "UQ_OSHP_Name" UNIQUE ("TrnspName"),
  ADD CONSTRAINT "CK_OSHP_Name" CHECK (char_length("TrnspName") BETWEEN 1 AND 40);

-- Branches (India: GSTIN per branch). Page-only properties live in SlExtra.
ALTER TABLE "OBPL"
  ADD "AddtnlId" TEXT, ADD "TaxOffice" TEXT, ADD "GSTRegnNo" TEXT, ADD "GSTType" TEXT, ADD "SlExtra" JSONB,
  ADD CONSTRAINT "UQ_OBPL_Name" UNIQUE ("BPLName"),
  ADD CONSTRAINT "FK_OBPL_Warehouse" FOREIGN KEY ("DflWhs") REFERENCES "OWHS"("WhsCode");

-- Chart of accounts.
ALTER TABLE "OACT"
  ADD "Protected" CHAR(1) NOT NULL DEFAULT 'N', ADD "Budget" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "RevalMatch" CHAR(1) NOT NULL DEFAULT 'N', ADD "Project" TEXT, ADD "Details" TEXT, ADD "SlExtra" JSONB;
ALTER TABLE "OACT"
  ADD CONSTRAINT "CK_OACT_Sizes" CHECK (char_length("AcctCode") BETWEEN 1 AND 15 AND char_length("AcctName") BETWEEN 1 AND 200),
  ADD CONSTRAINT "CK_OACT_Flags" CHECK ("Postable" IN ('Y', 'N') AND "FrozenFor" IN ('Y', 'N')),
  ADD CONSTRAINT "FK_OACT_Tax" FOREIGN KEY ("DfltTax") REFERENCES "OSTC"("Code");
