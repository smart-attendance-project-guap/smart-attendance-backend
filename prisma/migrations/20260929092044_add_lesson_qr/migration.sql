/*
  Warnings:

  - A unique constraint covering the columns `[qrToken]` on the table `Lesson` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "qrExpiresAt" TIMESTAMP(3),
ADD COLUMN     "qrToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_qrToken_key" ON "Lesson"("qrToken");
