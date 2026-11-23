import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma.js";
import {
  scheduleUpcomingTelegramReminders,
  scheduleMissedTelegramNotifications,
} from "../src/services/telegramNotificationScheduler.js";

// Test-only data in the current local PostgreSQL database.
// Fake Telegram IDs are deliberately not valid real Telegram IDs.
// No bot, HTTP server, real message send, or notification worker is started.
const lessonIds: number[] = [];
const userIds: number[] = [];
let classroomId: number | undefined;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in local .env");

  const groups = await prisma.group.findMany({
    where: { name: { in: ["4514", "4515", "4516"] } },
    select: { id: true, name: true },
  });
  const byName = new Map(groups.map((g) => [g.name, g.id]));
  const g1 = byName.get("4514");
  const g2 = byName.get("4515");
  const outsiderGroup = byName.get("4516");
  assert(g1 !== undefined && g2 !== undefined && outsiderGroup !== undefined,
    "First seed groups 4514, 4515 and 4516");

  const makeUser = async (
    role: "TEACHER" | "STUDENT",
    groupId: number | null,
    hasTelegram: boolean,
  ) => {
    const user = await prisma.user.create({
      data: {
        email: "telegram-smoke-" + randomUUID() + "@example.invalid",
        password: "smoke-only-no-login",
        firstName: "Telegram",
        lastName: "Smoke",
        role,
        groupId,
        // Not a real Telegram user ID, so the bot cannot send a real message.
        telegramId: hasTelegram ? "smoke-" + randomUUID() : null,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  };

  const teacherId = await makeUser("TEACHER", null, false);
  const group4514 = await makeUser("STUDENT", g1, true);
  const group4515 = await makeUser("STUDENT", g2, true);
  const noTelegram = await makeUser("STUDENT", g1, false);
  const outsider = await makeUser("STUDENT", outsiderGroup, true);

  const classroom = await prisma.classroom.create({
    data: {
      name: "SMOKE-TELEGRAM-" + randomUUID().slice(0, 8),
      latitude: 59.929561,
      longitude: 30.296671,
    },
    select: { id: true },
  });
  classroomId = classroom.id;

  const makeSharedLesson = async (
    startsAt: Date,
    endsAt: Date,
    finishedAt: Date | null,
  ) => {
    const lesson = await prisma.lesson.create({
      data: {
        teacherId,
        groupId: g1,
        classroomId: classroom.id,
        discipline: "SMOKE Telegram notification",
        startsAt,
        endsAt,
        finishedAt,
        lessonGroups: { create: [{ groupId: g2 }] },
      },
      select: { id: true },
    });
    lessonIds.push(lesson.id);
    return lesson.id;
  };

  const now = Date.now();
  const minute = 60_000;

  // Starts in 10 minutes: reminder must include both participating groups.
  const upcoming = await makeSharedLesson(
    new Date(now + 10 * minute),
    new Date(now + 100 * minute),
    null,
  );

  // Finished and scheduled end both happened recently.
  // A pending attendance counts as a recorded mark, not as a missed class.
  const justEnded = await makeSharedLesson(
    new Date(now - 90 * minute),
    new Date(now - minute),
    new Date(now - 2 * minute),
  );
  await prisma.attendance.create({
    data: { lessonId: justEnded, studentId: group4515, status: "PENDING" },
  });

  // Teacher finished early, but scheduled end has not yet been reached.
  const finishedEarly = await makeSharedLesson(
    new Date(now - 20 * minute),
    new Date(now + 30 * minute),
    new Date(now - 2 * minute),
  );

  // Teacher finished long ago, scheduled end occurred recently.
  const endedAfterEarlyFinish = await makeSharedLesson(
    new Date(now - 90 * minute),
    new Date(now - minute),
    new Date(now - 20 * minute),
  );

  // Passing only test lesson IDs guarantees we do not queue notifications
  // for unrelated students or lessons in the local database.
  const reminders = await scheduleUpcomingTelegramReminders(lessonIds);
  const reminderRows = await prisma.telegramNotification.findMany({
    where: { lessonId: upcoming, type: "LESSON_REMINDER" },
    select: { userId: true, scheduledAt: true },
  });
  const reminderUsers = new Set(reminderRows.map((row) => row.userId));
  assert(reminders === 2 &&
    reminderRows.length === 2 &&
    reminderUsers.has(group4514) &&
    reminderUsers.has(group4515),
    "Expected exactly two upcoming reminders for 4514 and 4515");
  console.log("PASS: both participating groups get lesson reminders");

  assert(!reminderUsers.has(noTelegram) && !reminderUsers.has(outsider),
    "Reminder unexpectedly included outsider or student without Telegram");
  console.log("PASS: outsider and unlinked Telegram user excluded");

  const reminderAgain = await scheduleUpcomingTelegramReminders(lessonIds);
  assert(reminderAgain === 0, "Duplicate reminder was added");
  console.log("PASS: duplicate reminders are not created");

  const missed = await scheduleMissedTelegramNotifications(lessonIds);
  assert(missed === 3, "Expected three missed notifications, got " + missed);

  const missedRows = await prisma.telegramNotification.findMany({
    where: {
      lessonId: { in: lessonIds },
      type: "LESSON_MISSED",
    },
    select: { lessonId: true, userId: true },
  });
  const hasMiss = (lessonId: number, userId: number) =>
    missedRows.some((row) => row.lessonId === lessonId && row.userId === userId);

  assert(missedRows.length === 3 &&
    hasMiss(justEnded, group4514) &&
    !hasMiss(justEnded, group4515) &&
    hasMiss(endedAfterEarlyFinish, group4514) &&
    hasMiss(endedAfterEarlyFinish, group4515),
    "Missed notifications ignored recorded attendance or lost a group");
  console.log("PASS: missed notices exclude PENDING attendance and include both groups");

  assert(!missedRows.some((row) => row.lessonId === finishedEarly) &&
    !missedRows.some((row) => row.userId === outsider || row.userId === noTelegram),
    "Premature or unrelated missed notification was created");
  console.log("PASS: early finish excluded until endsAt, outsiders excluded");

  const missedAgain = await scheduleMissedTelegramNotifications(lessonIds);
  assert(missedAgain === 0, "Duplicate missed notification was added");
  console.log("PASS: duplicate missed notices are not created");

  const expectedReminderDate = now + 10 * minute - 15 * minute;
  assert(reminderRows.every((row) =>
    Math.abs(row.scheduledAt.getTime() - expectedReminderDate) < 1000,
  ), "Reminder was not scheduled 15 minutes before start");
  console.log("PASS: reminder scheduled 15 minutes before lesson starts");
}

async function cleanup() {
  try {
    if (lessonIds.length > 0) {
      await prisma.telegramNotification.deleteMany({
        where: { lessonId: { in: lessonIds } },
      });
      await prisma.attendance.deleteMany({
        where: { lessonId: { in: lessonIds } },
      });
      await prisma.lesson.deleteMany({
        where: { id: { in: lessonIds } },
      });
    }
    if (classroomId !== undefined) {
      await prisma.classroom.delete({ where: { id: classroomId } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error("FAIL: shared Telegram notification smoke test", error);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
    console.log("Temporary Telegram smoke records cleaned up.");
  } catch (error) {
    console.error("Cleanup failed; inspect temporary telegram-smoke records:", error);
    process.exitCode = 1;
  }
}
