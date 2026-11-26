
import { prisma } from "../prisma.js";
import { isAttendanceExcluded } from "../utils/attendanceDisciplinePolicy.js";

const REMINDER_MINUTES = 15;

export async function scheduleUpcomingTelegramReminders(lessonIds?: number[]) {
  const now = new Date();

  const reminderWindowEnd = new Date(
    now.getTime() + REMINDER_MINUTES * 60_000,
  );

  const lessons = await prisma.lesson.findMany({
    where: {
      // Optional restriction lets the isolated smoke test avoid real lessons.
      ...(lessonIds !== undefined ? { id: { in: lessonIds } } : {}),
      startsAt: {
        gt: now,
        lte: reminderWindowEnd,
      },
      finishedAt: null,
    },
    select: {
      id: true,
      discipline: true,
      startsAt: true,
      lessonGroups: {
        select: {
          group: {
            select: {
              users: {
                where: { role: "STUDENT", telegramId: { not: null } },
                select: { id: true },
              },
            },
          },
        },
      },
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

  const notifications = lessons.filter((lesson) => !isAttendanceExcluded(lesson.discipline)).flatMap((lesson) =>
    [...lesson.group.users, ...lesson.lessonGroups.flatMap((item) => item.group.users)]
      .map((student) => ({
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


export async function scheduleMissedTelegramNotifications(lessonIds?: number[]) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 10 * 60_000);

  const lessons = await prisma.lesson.findMany({
    where: {
      ...(lessonIds !== undefined ? { id: { in: lessonIds } } : {}),
      // Teacher's finish action is the actual end; do not wait for endsAt.
      // The scheduled end must not trigger a second missed notification.
      finishedAt: { gt: windowStart, lte: now },
    },
    select: {
      id: true,
      discipline: true,
      lessonGroups: {
        select: {
          group: {
            select: {
              users: {
                where: { role: "STUDENT", telegramId: { not: null } },
                select: { id: true },
              },
            },
          },
        },
      },
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

  const notifications = lessons.filter((lesson) => !isAttendanceExcluded(lesson.discipline)).flatMap((lesson) => {
    const markedStudentIds = new Set(
      lesson.attendances.map((a) => a.studentId),
    );

    return [...lesson.group.users, ...lesson.lessonGroups.flatMap((item) => item.group.users)]
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
