
import { prisma } from "../prisma.js";

export type TelegramNotificationType =
  | "LESSON_REMINDER"
  | "LESSON_MISSED"
  | "ATTENDANCE_CONFIRMED"
  | "ATTENDANCE_REJECTED";

type CreateNotificationParams = {
  userId: number;
  lessonId: number;
  type: TelegramNotificationType;
  scheduledAt: Date;
};

export async function enqueueTelegramNotification({
  userId,
  lessonId,
  type,
  scheduledAt,
}: CreateNotificationParams) {
  return prisma.telegramNotification.upsert({
    where: {
      userId_lessonId_type: {
        userId,
        lessonId,
        type,
      },
    },
    update: {},
    create: {
      userId,
      lessonId,
      type,
      scheduledAt,
      status: "PENDING",
    },
  });
}


export async function enqueueAttendanceDecisionNotification(
  userId: number,
  lessonId: number,
  type: "ATTENDANCE_CONFIRMED" | "ATTENDANCE_REJECTED",
) {
  const student = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramId: true },
  });

  if (!student?.telegramId) {
    return null;
  }

  return enqueueTelegramNotification({
    userId,
    lessonId,
    type,
    scheduledAt: new Date(),
  });
}
