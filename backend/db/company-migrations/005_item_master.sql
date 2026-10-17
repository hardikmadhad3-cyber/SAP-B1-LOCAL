-- Item master to the SAP B1 10.0 SDK definition (OITM) so every field the Item
-- Master page sends has a column. Columns come from services/localItemFields.js
-- (generated from the reader); defaults follow the SDK. Also SAP's item
-- collections: prices (ITM1), per-warehouse data (OITW), barcodes (OBCD),
-- preferred vendors (ITM2).

ALTER TABLE "OITM"
  ADD "CstGrpCode" INTEGER,
  ADD "VATLiable" CHAR(1) NOT NULL DEFAULT 'Y',
  ADD "IncomeAcct" TEXT,
  ADD "ExmptIncom" TEXT,
  ADD "ExpensAcct" TEXT,
  ADD "SuppCatNum" TEXT,
  ADD "ReorderQty" NUMERIC(19,6),
  ADD "MinLevel" NUMERIC(19,6),
  ADD "MaxLevel" NUMERIC(19,6),
  ADD "PurPackMsr" TEXT,
  ADD "PurPackUn" NUMERIC(19,6),
  ADD "SalPackMsr" TEXT,
  ADD "SalPackUn" NUMERIC(19,6),
  ADD "BLength1" NUMERIC(19,6),
  ADD "BLen1Unit" TEXT,
  ADD "BWidth1" NUMERIC(19,6),
  ADD "BWdth1Unit" TEXT,
  ADD "BHeight1" NUMERIC(19,6),
  ADD "BHght1Unit" TEXT,
  ADD "BVolume" NUMERIC(19,6),
  ADD "BVolUnit" TEXT,
  ADD "BWeight1" NUMERIC(19,6),
  ADD "BWght1Unit" TEXT,
  ADD "BWeight2" NUMERIC(19,6),
  ADD "BWght2Unit" TEXT,
  ADD "SLength1" NUMERIC(19,6),
  ADD "SLen1Unit" TEXT,
  ADD "SWidth1" NUMERIC(19,6),
  ADD "SWdth1Unit" TEXT,
  ADD "SHeight1" NUMERIC(19,6),
  ADD "SHght1Unit" TEXT,
  ADD "SVolume" NUMERIC(19,6),
  ADD "SVolUnit" TEXT,
  ADD "SWeight1" NUMERIC(19,6),
  ADD "SWght1Unit" TEXT,
  ADD "SWeight2" NUMERIC(19,6),
  ADD "SWght2Unit" TEXT,
  ADD "CommisPcnt" NUMERIC(19,6),
  ADD "CommisSum" NUMERIC(19,6),
  ADD "CommisGrp" INTEGER,
  ADD "ExportCode" TEXT,
  ADD "validFrom" DATE,
  ADD "validTo" DATE,
  ADD "ValidComm" TEXT,
  ADD "frozenFrom" DATE,
  ADD "frozenTo" DATE,
  ADD "FrozenComm" TEXT,
  ADD "SalFactor1" NUMERIC(19,6),
  ADD "SalFactor2" NUMERIC(19,6),
  ADD "SalFactor3" NUMERIC(19,6),
  ADD "SalFactor4" NUMERIC(19,6),
  ADD "PurFactor1" NUMERIC(19,6),
  ADD "PurFactor2" NUMERIC(19,6),
  ADD "PurFactor3" NUMERIC(19,6),
  ADD "PurFactor4" NUMERIC(19,6),
  ADD "FrgnInAcct" TEXT,
  ADD "ECInAcct" TEXT,
  ADD "FrgnExpAcc" TEXT,
  ADD "ECExpAcc" TEXT,
  ADD "ShipType" INTEGER,
  ADD "GLMethod" TEXT NOT NULL DEFAULT 'W',
  ADD "TaxType" TEXT NOT NULL DEFAULT 'Y',
  ADD "ByWh" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "WTLiable" CHAR(1) NOT NULL DEFAULT 'Y',
  ADD "WarrntTmpl" TEXT,
  ADD "IndirctTax" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "TaxCodeAR" TEXT,
  ADD "TaxCodeAP" TEXT,
  ADD "BaseUnit" TEXT,
  ADD "MngMethod" TEXT NOT NULL DEFAULT 'R',
  ADD "Phantom" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "PlaningSys" TEXT NOT NULL DEFAULT 'N',
  ADD "PrcrmntMtd" TEXT NOT NULL DEFAULT 'B',
  ADD "OrdrIntrvl" NUMERIC(19,6),
  ADD "OrdrMulti" NUMERIC(19,6),
  ADD "LeadTime" NUMERIC(19,6),
  ADD "MinOrdrQty" NUMERIC(19,6),
  ADD "OSvcCode" TEXT,
  ADD "ISvcCode" TEXT,
  ADD "ServiceGrp" INTEGER,
  ADD "NCMCode" TEXT,
  ADD "MatType" INTEGER,
  ADD "MatGrp" INTEGER,
  ADD "ProductSrc" TEXT,
  ADD "UserText" TEXT,
  ADD "SerialNum" TEXT,
  ADD "NoDiscount" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "AssetClass" INTEGER,
  ADD "AssetGroup" INTEGER,
  ADD "InventryNo" TEXT,
  ADD "Technician" INTEGER,
  ADD "Employee" INTEGER,
  ADD "Location" INTEGER,
  ADD "AsstStatus" INTEGER,
  ADD "CapDate" DATE,
  ADD "StatAsset" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "Cession" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "DeacAftUL" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "MgrByQty" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "DeprGroup" INTEGER,
  ADD "AssetSerNo" TEXT,
  ADD "IWeight1" NUMERIC(19,6),
  ADD "IWght1Unit" TEXT,
  ADD "IWeight2" NUMERIC(19,6),
  ADD "IWght2Unit" TEXT,
  ADD "CntUnitMsr" TEXT,
  ADD "NumInCnt" NUMERIC(19,6),
  ADD "INUoMEntry" INTEGER,
  ADD "Excisable" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "ScsCode" TEXT,
  ADD "SpProdType" TEXT,
  ADD "PrdStdCst" NUMERIC(19,6),
  ADD "InCostRoll" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "VirtAstItm" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "EnAstSeri" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "AtcEntry" INTEGER,
  ADD "LinkRsc" TEXT,
  ADD "GSTRelevnt" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "GstTaxCtg" TEXT NOT NULL DEFAULT 'R',
  ADD "ServiceCtg" INTEGER,
  ADD "OnHldPert" NUMERIC(19,6),
  ADD "onHldLimt" NUMERIC(19,6),
  ADD "AssblValue" NUMERIC(19,6),
  ADD "AssVal4WTR" NUMERIC(19,6),
  ADD "SOIExc" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "TNVED" TEXT,
  ADD "Imported" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "PriceUnit" NUMERIC(19,6),
  ADD "QRCodeSrc" TEXT,
  ADD "Traceable" CHAR(1) NOT NULL DEFAULT 'N',
  ADD "CommClass" TEXT,
  ADD "PlPaWght" NUMERIC(19,6),
  ADD "PlPaTaxCat" TEXT,
  ADD "PPTExReSa" TEXT,
  ADD "PPTExRePr" TEXT,
  ADD "ProdctType" TEXT,
  ADD "ProdTypeEx" TEXT;

-- Item numbering series (SDK OITM.Series -> NNM1, object 4).
ALTER TABLE "OITM" ADD "Series" INTEGER REFERENCES "NNM1"("Series");

-- SDK: ItemType is I/L/T/F, not a number.
ALTER TABLE "OITM" ALTER COLUMN "ItemType" DROP DEFAULT;
ALTER TABLE "OITM" ALTER COLUMN "ItemType" TYPE TEXT USING 'I';
ALTER TABLE "OITM" ALTER COLUMN "ItemType" SET DEFAULT 'I';
ALTER TABLE "OITM" ALTER COLUMN "ItemClass" TYPE TEXT USING "ItemClass"::text;
ALTER TABLE "OITM" ALTER COLUMN "ItemClass" SET DEFAULT '2';
ALTER TABLE "OITM" ALTER COLUMN "VatGourpSa" DROP DEFAULT, ALTER COLUMN "VatGroupPu" DROP DEFAULT;

-- SDK sizes, Y/N flags and the masters items point at.
ALTER TABLE "OITM"
  ADD CONSTRAINT "CK_OITM_Code" CHECK (char_length("ItemCode") BETWEEN 1 AND 50),
  ADD CONSTRAINT "CK_OITM_Name" CHECK (char_length("ItemName") BETWEEN 1 AND 200),
  ADD CONSTRAINT "CK_OITM_Flags" CHECK ("InvntItem" IN ('Y','N') AND "SellItem" IN ('Y','N') AND "PrchseItem" IN ('Y','N')
    AND "validFor" IN ('Y','N') AND "frozenFor" IN ('Y','N')),
  ADD CONSTRAINT "FK_OITM_DfltWH" FOREIGN KEY ("DfltWH") REFERENCES "OWHS"("WhsCode"),
  ADD CONSTRAINT "FK_OITM_Vendor" FOREIGN KEY ("CardCode") REFERENCES "OCRD"("CardCode"),
  ADD CONSTRAINT "FK_OITM_TaxAR" FOREIGN KEY ("TaxCodeAR") REFERENCES "OSTC"("Code"),
  ADD CONSTRAINT "FK_OITM_TaxAP" FOREIGN KEY ("TaxCodeAP") REFERENCES "OSTC"("Code"),
  ADD CONSTRAINT "FK_OITM_UoMGroup" FOREIGN KEY ("UgpEntry") REFERENCES "OUGP"("UgpEntry"),
  ADD CONSTRAINT "FK_OITM_Manufacturer" FOREIGN KEY ("FirmCode") REFERENCES "OMRC"("FirmCode"),
  ADD CONSTRAINT "FK_OITM_IncomeAcct" FOREIGN KEY ("IncomeAcct") REFERENCES "OACT"("AcctCode"),
  ADD CONSTRAINT "FK_OITM_ExmptIncom" FOREIGN KEY ("ExmptIncom") REFERENCES "OACT"("AcctCode"),
  ADD CONSTRAINT "FK_OITM_ExpensAcct" FOREIGN KEY ("ExpensAcct") REFERENCES "OACT"("AcctCode"),
  ADD CONSTRAINT "FK_OITM_FrgnInAcct" FOREIGN KEY ("FrgnInAcct") REFERENCES "OACT"("AcctCode"),
  ADD CONSTRAINT "FK_OITM_FrgnExpAcc" FOREIGN KEY ("FrgnExpAcc") REFERENCES "OACT"("AcctCode");

-- Prices per price list (SDK ITM1).
ALTER TABLE "ITM1"
  ADD "AddPrice1" NUMERIC(19,6) NOT NULL DEFAULT 0, ADD "Currency1" TEXT,
  ADD "AddPrice2" NUMERIC(19,6) NOT NULL DEFAULT 0, ADD "Currency2" TEXT,
  ADD "BasePLNum" INTEGER REFERENCES "OPLN"("ListNum"), ADD "Factor" NUMERIC(19,6) NOT NULL DEFAULT 1;
ALTER TABLE "ITM1" DROP CONSTRAINT "ITM1_ItemCode_fkey";
ALTER TABLE "ITM1" ADD CONSTRAINT "ITM1_ItemCode_fkey" FOREIGN KEY ("ItemCode") REFERENCES "OITM"("ItemCode") ON DELETE CASCADE;

-- Item per warehouse (SDK OITW): one row per item and warehouse.
ALTER TABLE "OITW"
  ADD "MinOrder" NUMERIC(19,6) NOT NULL DEFAULT 0, ADD "Locked" CHAR(1) NOT NULL DEFAULT 'N';

-- Barcodes (SDK OBCD) and preferred vendors (SDK ITM2).
CREATE TABLE "OBCD" (
  "BcdEntry" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  "BcdCode" TEXT NOT NULL UNIQUE CHECK (char_length("BcdCode") <= 254),
  "BcdName" TEXT,
  "ItemCode" TEXT NOT NULL REFERENCES "OITM"("ItemCode") ON DELETE CASCADE,
  "UomEntry" INTEGER REFERENCES "OUOM"("UomEntry")
);
CREATE TABLE "ITM2" (
  "ItemCode" TEXT NOT NULL REFERENCES "OITM"("ItemCode") ON DELETE CASCADE,
  "VendorCode" TEXT NOT NULL REFERENCES "OCRD"("CardCode"),
  PRIMARY KEY ("ItemCode", "VendorCode")
);
