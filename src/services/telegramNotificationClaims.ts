
import { prisma } from "../prisma.js";

type ClaimedNotification = {
  notificationId: number;
  leaseToken: string;
  telegramId: string;
  type: string;
  lessonId: number;
  discipline: string | null;
  startsAt: Date;
  endsAt: Date;
  attendanceStatus: string | null;
  rejectionReason: string | null;
};

export async function claimTelegramNotifications(limit: number) {
  const safeLimit = Math.max(1, Math.min(10, limit));

  await prisma.$executeRaw`
    UPDATE "TelegramNotification"
    SET
      "status" = 'FAILED'::"TelegramNotificationStatus",
      "lastErrorCode" = 'MAX_ATTEMPTS_EXCEEDED',
      "leaseToken" = NULL,
      "leaseExpiresAt" = NULL,
      "updatedAt" = NOW()
    WHERE "status" = 'PROCESSING'::"TelegramNotificationStatus"
      AND "attempts" >= 5
      AND "leaseExpiresAt" <= NOW()
  `;


  const notifications = await prisma.$queryRaw<ClaimedNotification[]>`
    WITH candidates AS (
      SELECT n."id"
      FROM "TelegramNotification" n
      JOIN "User" u ON u."id" = n."userId"
      WHERE u."telegramId" IS NOT NULL
        AND n."attempts" < 5
        AND (
          (
            n."status" = 'PENDING'
            AND n."scheduledAt" <= NOW()
          )
          OR (
            n."status" = 'PROCESSING'
            AND n."leaseExpiresAt" <= NOW()
          )
        )
      ORDER BY n."scheduledAt", n."id"
      FOR UPDATE OF n SKIP LOCKED
      LIMIT ${safeLimit}
    ),
    claimed AS (
      UPDATE "TelegramNotification" n
      SET
        "status" = 'PROCESSING',
        "leaseToken" = gen_random_uuid()::text,
        "leaseExpiresAt" = NOW() + INTERVAL '90 seconds',
        "attempts" = n."attempts" + 1,
        "updatedAt" = NOW()
      FROM candidates c
      WHERE n."id" = c."id"
      RETURNING n.*
    )
    SELECT
      n."id" AS "notificationId",
      n."leaseToken",
      u."telegramId",
      n."type"::text AS "type",
      n."lessonId",
      l."discipline",
      l."startsAt",
      l."endsAt",
      a."status"::text AS "attendanceStatus",
      a."rejectionReason"
    FROM claimed n
    JOIN "User" u ON u."id" = n."userId"
    JOIN "Lesson" l ON l."id" = n."lessonId"
    LEFT JOIN "Attendance" a
      ON a."studentId" = n."userId"
      AND a."lessonId" = n."lessonId"
    ORDER BY n."id"
  `;

  return notifications.map((notification) => ({
    ...notification,
    startsAt: notification.startsAt.toISOString(),
    endsAt: notification.endsAt.toISOString(),
  }));
}
