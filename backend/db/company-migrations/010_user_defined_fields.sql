-- User-defined fields (SAP: CUFD field definitions, UFD1 valid values; the field
-- itself is a physical "U_<Name>" column added to the table at runtime).

ALTER TABLE "UFD1" ADD "FldDate" DATE;
-- Columns the SDK defines that the local schema did not have yet.
ALTER TABLE "CUFD" ADD "Sys" CHAR(1) DEFAULT 'N';
CREATE UNIQUE INDEX "UX_CUFD_Alias" ON "CUFD" ("TableID", lower("AliasID"));

-- Local extension (not in SAP): a formula that fills the field on save and a
-- validation rule with its own message. SAP does this with formatted searches
-- and transaction notifications; one row per field.
CREATE TABLE "LocalUdfRule" (
  "TableID" TEXT NOT NULL,
  "AliasID" TEXT NOT NULL,
  "Formula" TEXT,
  "Validation" TEXT,
  "Message" TEXT,
  PRIMARY KEY ("TableID", "AliasID")
);
