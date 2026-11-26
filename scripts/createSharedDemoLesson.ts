// Creates ONE temporary shared lesson in the local development database.
// Never changes existing users, attendance marks or lessons.
import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { isAttendanceExcluded } from "../src/utils/attendanceDisciplinePolicy.js";

const teacherEmail = "teacher@example.com";
const allowedDatabase = "/smart_attendance";

async function main() {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new Error("DATABASE_URL is missing");
  const url = new URL(configuredUrl);
  const database = url.pathname;
  if (database !== allowedDatabase ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      process.env.CONFIRM_SHARED_DEMO !== teacherEmail) {
    throw new Error(
      "STOP: this script requires the local smart_attendance DB and " +
      "CONFIRM_SHARED_DEMO=teacher@example.com. Current DB: " + database +
      ", host: " + url.hostname,
    );
  }

  const teacher = await prisma.user.findUnique({
    where: { email: teacherEmail },
    select: { id: true, email: true, role: true },
  });
  if (!teacher || teacher.role !== "TEACHER") {
    throw new Error("Existing TEACHER account teacher@example.com not found in this database");
  }

  const groups = await prisma.group.findMany({
    where: { name: { in: ["4515", "4516"] } },
    select: { id: true, name: true },
  });
  const first = groups.find((group) => group.name === "4515");
  const second = groups.find((group) => group.name === "4516");
  if (!first || !second) throw new Error("Seed groups 4515 and 4516 first");

  const now = Date.now();
  // Reuse an ongoing matching test lesson instead of creating duplicates.
  const existing = await prisma.lesson.findFirst({
    where: {
      teacherId: teacher.id,
      groupId: first.id,
      lessonGroups: { some: { groupId: second.id } },
      startsAt: { gte: new Date(now - 30 * 60_000), lte: new Date(now) },
      endsAt: { gt: new Date(now) },
      finishedAt: null,
    },
    select: { id: true, discipline: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "desc" },
  });
  if (existing) {
    console.log("Existing active shared lesson:", existing.id);
    console.log("Teacher:", teacher.email, "Groups: 4515, 4516");
    console.log("Starts:", existing.startsAt.toISOString());
    console.log("Ends:", existing.endsAt.toISOString());
    return;
  }

  // Start just before now to allow QR immediately; keep the window open for testing.
  const startsAt = new Date(now - 2 * 60_000);
  const endsAt = new Date(now + 75 * 60_000);

  const overlapping = await prisma.lesson.findFirst({
    where: {
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      OR: [
        { teacherId: teacher.id },
        { groupId: { in: [first.id, second.id] } },
        { lessonGroups: { some: { groupId: { in: [first.id, second.id] } } } },
      ],
    },
    select: { id: true },
  });
  if (overlapping) {
    throw new Error(
      "A teacher or one of the groups already has lesson #" + overlapping.id +
      " in this period. Existing lessons were left unchanged.",
    );
  }

  const disciplines = await prisma.discipline.findMany({
    select: { name: true }, orderBy: { name: "asc" },
  });
  const discipline = disciplines.find((item) => !isAttendanceExcluded(item.name));
  if (!discipline) throw new Error("No non-PE disciplines in this database");

  const classrooms = await prisma.classroom.findMany({
    select: { id: true, name: true }, orderBy: { id: "asc" },
  });
  let freeRoom: (typeof classrooms)[number] | undefined;
  for (const room of classrooms) {
    const occupied = await prisma.lesson.findFirst({
      where: {
        classroomId: room.id,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });
    if (!occupied) { freeRoom = room; break; }
  }
  if (!freeRoom) throw new Error("No free classroom during the test interval");

  const lesson = await prisma.lesson.create({
    data: {
      teacherId: teacher.id,
      groupId: first.id,
      classroomId: freeRoom.id,
      discipline: discipline.name,
      startsAt,
      endsAt,
      lessonGroups: { create: { groupId: second.id } },
    },
    select: { id: true, startsAt: true, endsAt: true, discipline: true },
  });

  console.log("CREATED shared test lesson:", lesson.id);
  console.log("Teacher:", teacher.email, "(ID", teacher.id + ")");
  console.log("Participating groups:", first.name, "(ID", first.id + "),", second.name, "(ID", second.id + ")");
  console.log("Discipline:", lesson.discipline);
  console.log("Classroom:", freeRoom.name, "(ID", freeRoom.id + ")");
  console.log("Starts:", lesson.startsAt.toISOString());
  console.log("Ends:", lesson.endsAt.toISOString());
  console.log("Open the teacher lesson list in the same database.");
  console.log("The lesson appears in attendance statistics AFTER the teacher finishes it.");
  console.log("The script did not create or alter any student attendance records.");
}

main().catch((error) => {
  console.error("Failed to prepare shared demo lesson:", error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
