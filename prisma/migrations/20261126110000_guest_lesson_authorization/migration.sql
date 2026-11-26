CREATE TABLE "LessonGuest" (
  "lessonId" INTEGER NOT NULL,
  "studentId" INTEGER NOT NULL,
  CONSTRAINT "LessonGuest_pkey" PRIMARY KEY ("lessonId", "studentId")
);
CREATE INDEX "LessonGuest_studentId_idx" ON "LessonGuest"("studentId");
ALTER TABLE "LessonGuest" ADD CONSTRAINT "LessonGuest_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonGuest" ADD CONSTRAINT "LessonGuest_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
