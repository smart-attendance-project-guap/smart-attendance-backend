-- CreateEnum
CREATE TYPE "TelegramNotificationType" AS ENUM ('LESSON_REMINDER', 'LESSON_MISSED', 'ATTENDANCE_CONFIRMED', 'ATTENDANCE_REJECTED');

-- CreateEnum
CREATE TYPE "TelegramNotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "TelegramNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "type" "TelegramNotificationType" NOT NULL,
    "status" "TelegramNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "telegramMessageId" INTEGER,
    "lastErrorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramNotification_leaseToken_key" ON "TelegramNotification"("leaseToken");

-- CreateIndex
CREATE INDEX "TelegramNotification_status_scheduledAt_idx" ON "TelegramNotification"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "TelegramNotification_status_leaseExpiresAt_idx" ON "TelegramNotification"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramNotification_userId_lessonId_type_key" ON "TelegramNotification"("userId", "lessonId", "type");

-- AddForeignKey
ALTER TABLE "TelegramNotification" ADD CONSTRAINT "TelegramNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramNotification" ADD CONSTRAINT "TelegramNotification_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
