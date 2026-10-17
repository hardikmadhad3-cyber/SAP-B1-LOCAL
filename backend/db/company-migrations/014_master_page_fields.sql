-- Master pages: fields the pages entered that had nowhere to go.

-- Payment Terms page: its own short code (max 15) and the Load Limit Credit flag.
-- SAP's OCTG keeps only PymntGroup (filled from the page's name), so these are local columns.
ALTER TABLE "OCTG"
  ADD COLUMN IF NOT EXISTS "PymntCode" VARCHAR(15),
  ADD COLUMN IF NOT EXISTS "LoadLimit" CHAR(1) DEFAULT 'N' CHECK ("LoadLimit" IN ('Y','N'));
CREATE UNIQUE INDEX IF NOT EXISTS "OCTG_code_unique" ON "OCTG" (lower("PymntCode")) WHERE "PymntCode" IS NOT NULL;

-- Branches created before the fix got the table defaults: a second main branch and
-- warehouse 01 (which belongs to another branch), so every later edit was refused.
UPDATE "OBPL" b SET "MainBPL" = 'N'
 WHERE b."MainBPL" = 'Y' AND b."BPLId" <> (SELECT MIN("BPLId") FROM "OBPL" WHERE "MainBPL" = 'Y');
UPDATE "OBPL" b SET "DflWhs" = NULL
 WHERE b."DflWhs" IS NOT NULL AND EXISTS (
   SELECT 1 FROM "OWHS" w WHERE w."WhsCode" = b."DflWhs" AND w."BPLid" IS NOT NULL AND w."BPLid" <> b."BPLId");
ALTER TABLE "OBPL" ALTER COLUMN "DflWhs" DROP DEFAULT, ALTER COLUMN "MainBPL" SET DEFAULT 'N';
