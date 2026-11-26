-- Preserve existing schedule rows; new metadata is optional for legacy imports.
ALTER TABLE "ScheduleEntry" ADD COLUMN "teacherId" INTEGER;
ALTER TABLE "ScheduleEntry" ADD COLUMN "sharedKey" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "sourceScheduleEntryId" INTEGER;

CREATE UNIQUE INDEX "Lesson_sourceScheduleEntryId_key" ON "Lesson"("sourceScheduleEntryId");
CREATE INDEX "ScheduleEntry_teacherId_startsAt_idx" ON "ScheduleEntry"("teacherId", "startsAt");
CREATE INDEX "ScheduleEntry_sharedKey_idx" ON "ScheduleEntry"("sharedKey");

ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_sourceScheduleEntryId_fkey"
  FOREIGN KEY ("sourceScheduleEntryId") REFERENCES "ScheduleEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
