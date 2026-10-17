-- India HSN ("Chapter ID", OCHP) and SAC (OSAC) to the SAP B1 10.0 SDK
-- definitions. Items point at them by internal key: OITM.ChapterID -> OCHP,
-- OITM.SACEntry -> OSAC. ChapterID is the HSN code printed on documents.

ALTER TABLE "OCHP" ADD "Chapter" TEXT;
UPDATE "OCHP" SET "Chapter" = left("ChapterID", 2) WHERE "Chapter" IS NULL;
ALTER TABLE "OCHP"
  ALTER COLUMN "ChapterID" SET NOT NULL,
  ADD CONSTRAINT "UQ_OCHP_ChapterID" UNIQUE ("ChapterID"),
  ADD CONSTRAINT "CK_OCHP_Sizes" CHECK (char_length("ChapterID") <= 64 AND char_length(COALESCE("Chapter", '')) <= 20
    AND char_length(COALESCE("Heading", '')) <= 20 AND char_length(COALESCE("SubHeading", '')) <= 20
    AND char_length(COALESCE("Dscription", '')) <= 120);
CREATE INDEX "IX_OCHP_Chapter" ON "OCHP" ("Chapter", "Heading", "SubHeading");

-- OSAC had alternative column names from an earlier draft; keep SAP's only.
UPDATE "OSAC" SET "ServCode" = COALESCE("ServCode", "ServiceCode", "SACCode"),
                  "ServName" = COALESCE("ServName", "ServiceName", "Dscription");
ALTER TABLE "OSAC" DROP COLUMN "SACCode", DROP COLUMN "ServiceCode", DROP COLUMN "ServiceName", DROP COLUMN "Dscription";
ALTER TABLE "OSAC"
  ALTER COLUMN "ServCode" SET NOT NULL,
  ALTER COLUMN "ServName" SET NOT NULL,
  ADD CONSTRAINT "UQ_OSAC_ServCode" UNIQUE ("ServCode"),
  ADD CONSTRAINT "CK_OSAC_Sizes" CHECK (char_length("ServCode") <= 8 AND char_length("ServName") <= 254);

ALTER TABLE "OITM"
  ADD CONSTRAINT "FK_OITM_ChapterID" FOREIGN KEY ("ChapterID") REFERENCES "OCHP"("AbsEntry"),
  ADD CONSTRAINT "FK_OITM_SACEntry" FOREIGN KEY ("SACEntry") REFERENCES "OSAC"("AbsEntry");
