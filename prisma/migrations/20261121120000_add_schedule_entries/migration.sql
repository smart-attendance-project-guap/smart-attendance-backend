-- Individual scheduled class occurrences for four supported student groups.
CREATE TABLE "ScheduleEntry" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "discipline" TEXT NOT NULL,
    "classroom" TEXT NOT NULL,
    "teacherName" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduleEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduleEntry_groupId_startsAt_idx" ON "ScheduleEntry"("groupId", "startsAt");

CREATE UNIQUE INDEX "ScheduleEntry_groupId_startsAt_discipline_classroom_key"
ON "ScheduleEntry"("groupId", "startsAt", "discipline", "classroom");

ALTER TABLE "ScheduleEntry"
ADD CONSTRAINT "ScheduleEntry_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
