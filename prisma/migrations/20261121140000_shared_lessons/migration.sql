-- Additional participant groups for a shared teacher lesson.
-- Lesson.groupId remains the primary group for backwards compatibility.
CREATE TABLE "LessonGroup" (
    "lessonId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    CONSTRAINT "LessonGroup_pkey" PRIMARY KEY ("lessonId", "groupId")
);
CREATE INDEX "LessonGroup_groupId_idx" ON "LessonGroup"("groupId");
ALTER TABLE "LessonGroup" ADD CONSTRAINT "LessonGroup_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonGroup" ADD CONSTRAINT "LessonGroup_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
