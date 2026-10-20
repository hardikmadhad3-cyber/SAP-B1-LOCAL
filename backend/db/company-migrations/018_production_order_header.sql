-- Production order header fields the page saves: actual closing date and
-- pick and pack remarks (SDK OWOR CloseDate / PickRmrk).
ALTER TABLE "OWOR"
  ADD COLUMN IF NOT EXISTS "CloseDate" DATE,
  ADD COLUMN IF NOT EXISTS "PickRmrk" TEXT;
