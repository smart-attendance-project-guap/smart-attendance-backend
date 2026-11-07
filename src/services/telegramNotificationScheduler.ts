
import { prisma } from "../prisma.js";

const REMINDER_MINUTES = 15;

export async function scheduleUpcomingTelegramReminders() {
  const now = new Date();

  const reminderWindowEnd = new Date(
    now.getTime() + REMINDER_MINUTES * 60_000,
  );

  const lessons = await prisma.lesson.findMany({
    where: {
      startsAt: {
        gt: now,
        lte: reminderWindowEnd,
      },
      finishedAt: null,
    },
    select: {
      id: true,
      startsAt: true,
      group: {
        select: {
          users: {
            where: {
              role: "STUDENT",
              telegramId: { not: null },
            },
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  const notifications = lessons.flatMap((lesson) =>
    lesson.group.users.map((student) => ({
      userId: student.id,
      lessonId: lesson.id,
      type: "LESSON_REMINDER" as const,
      scheduledAt: new Date(
        lesson.startsAt.getTime() - REMINDER_MINUTES * 60_000,
      ),
    })),
  );

  if (notifications.length === 0) {
    return 0;
  }

  const result = await prisma.telegramNotification.createMany({
    data: notifications,
    skipDuplicates: true,
  });

  return result.count;
}


const MISSED_WINDOW_MINUTES = 10;

export async function scheduleMissedTelegramNotifications() {
  const now = new Date();

  const windowStart = new Date(
    now.getTime() - MISSED_WINDOW_MINUTES * 60_000,
  );

  const lessons = await prisma.lesson.findMany({
    where: {
      finishedAt: {
        gt: windowStart,
        lte: now,
      },
    },
    select: {
      id: true,
      group: {
        select: {
          users: {
            where: {
              role: "STUDENT",
              telegramId: { not: null },
            },
            select: { id: true },
          },
        },
      },
      attendances: {
        select: { studentId: true },
      },
    },
  });

  const notifications = lessons.flatMap((lesson) => {
    const markedStudentIds = new Set(
      lesson.attendances.map((a) => a.studentId),
    );

    return lesson.group.users
      .filter((student) => !markedStudentIds.has(student.id))
      .map((student) => ({
        userId: student.id,
        lessonId: lesson.id,
        type: "LESSON_MISSED" as const,
        scheduledAt: now,
      }));
  });

  if (notifications.length === 0) {
    return 0;
  }

  const result = await prisma.telegramNotification.createMany({
    data: notifications,
    skipDuplicates: true,
  });

  return result.count;
}
