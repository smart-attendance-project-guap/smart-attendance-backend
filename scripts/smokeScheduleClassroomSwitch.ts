// Isolated HTTP regression: teacher may replace timetable room when starting a lesson.
// Run ONLY on local smart_attendance_mvp_test. Temporary data is removed afterwards.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { prisma } from "../src/prisma.js";
import { generateToken } from "../src/utils/jwt.js";
import scheduleProposalRoutes from "../src/routes/scheduleProposalRoutes.js";

const db = new URL(process.env.DATABASE_URL ?? "postgres://invalid:invalid@localhost/invalid");
if (db.pathname !== "/smart_attendance_mvp_test" ||
    !["localhost", "127.0.0.1"].includes(db.hostname)) {
  throw new Error("STOP: use ONLY local smart_attendance_mvp_test");
}
if (!process.env.JWT_SECRET) throw new Error("Missing JWT_SECRET");

const tag = randomUUID();
const createdGroups: number[] = [];
const createdUsers: number[] = [];
const createdRooms: number[] = [];
const createdSchedules: number[] = [];
const createdLessons: number[] = [];
let disciplineName: string | undefined;
const app = express();
app.use(express.json());
app.use("/api/schedule", scheduleProposalRoutes);
const server = createServer(app);
let port = 0;

function check(condition: unknown, message: string): asserts condition {
  assert.ok(condition, message);
}

async function post(id: number, token: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}/api/schedule/${id}/start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, data: await response.json() as any };
}

async function main() {
  const group = async () => {
    const row = await prisma.group.create({
      data: { name: `SMOKE-ROOM-GROUP-${randomUUID()}` },
      select: { id: true },
    });
    createdGroups.push(row.id);
    return row.id;
  };
  const teacher = async () => {
    const row = await prisma.user.create({
      data: {
        email: `smoke-room-${randomUUID()}@example.invalid`,
        firstName: "Room", lastName: "Smoke", password: "no-login",
        role: "TEACHER",
      },
      select: { id: true },
    });
    createdUsers.push(row.id);
    return { id: row.id, token: generateToken(row.id, "TEACHER") };
  };
  const room = async (label: string) => {
    const row = await prisma.classroom.create({
      data: { name: label, latitude: 59.929561, longitude: 30.296671 },
      select: { id: true },
    });
    createdRooms.push(row.id);
    return row.id;
  };
  const lesson = async (teacherId: number, groupId: number, classroomId: number,
                        startsAt: Date, endsAt: Date, finishedAt?: Date) => {
    const row = await prisma.lesson.create({
      data: {
        teacherId, groupId, classroomId, discipline: disciplineName,
        startsAt, endsAt, finishedAt,
      },
      select: { id: true },
    });
    createdLessons.push(row.id);
    return row.id;
  };
  const now = Date.now();
  const start = new Date(now - 60_000);
  const end = new Date(now + 45 * 60_000);
  const [g1, g2, g3] = await Promise.all([group(), group(), group()]);
  const [owner, outsider] = await Promise.all([teacher(), teacher()]);
  const originalName = `SMOKE-101-${tag}`;
  const changedName = `SMOKE-205-${tag}`;
  const [originalRoom, changedRoom, occupiedRoom] = await Promise.all([
    room(originalName), room(changedName), room(`SMOKE-303-${tag}`),
  ]);
  const discipline = await prisma.discipline.create({
    data: { name: `SMOKE-Room-Discipline-${tag}` },
    select: { name: true },
  });
  disciplineName = discipline.name;

  const sharedKey = `SMOKE-shared-${tag}`;
  const makeSchedule = async (groupId: number, teacherId: number, classroom: string,
                              shared: string | null = null) => {
    const row = await prisma.scheduleEntry.create({
      data: {
        groupId, teacherId, classroom, discipline: disciplineName!,
        startsAt: start, endsAt: end, sharedKey: shared, teacherName: "Smoke Teacher",
      },
      select: { id: true },
    });
    createdSchedules.push(row.id);
    return row.id;
  };
  const firstSchedule = await makeSchedule(g1, owner.id, originalName, sharedKey);
  const secondSchedule = await makeSchedule(g2, owner.id, originalName, sharedKey);
  const singleSchedule = await makeSchedule(g3, outsider.id, originalName);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;

  const notOwner = await post(firstSchedule, outsider.token, { classroomId: changedRoom });
  check(notOwner.status === 403, "Another teacher could start the owner's schedule");

  const invalid = await post(firstSchedule, owner.token, { classroomId: "205" });
  check(invalid.status === 400, `Invalid classroomId: ${JSON.stringify(invalid)}`);
  const unknown = await post(firstSchedule, owner.token, { classroomId: 2147483647 });
  check(unknown.status === 404, `Unknown classroomId: ${JSON.stringify(unknown)}`);

  // A busy room cannot be selected even when it exists in the DB.
  const occupiedId = await lesson(outsider.id, g3, occupiedRoom, start, end);
  const blockedRoom = await post(firstSchedule, owner.token, { classroomId: occupiedRoom });
  check(blockedRoom.status === 409 && blockedRoom.data.lessonId === occupiedId,
    `Occupied room was accepted: ${JSON.stringify(blockedRoom)}`);

  // Teacher conflict is independent of classroom and groups.
  const teacherConflictId = await lesson(owner.id, g3, occupiedRoom, start, end);
  const blockedTeacher = await post(firstSchedule, owner.token, { classroomId: changedRoom });
  check(blockedTeacher.status === 409 && blockedTeacher.data.lessonId === teacherConflictId,
    `Teacher overlap was accepted: ${JSON.stringify(blockedTeacher)}`);
  await prisma.lesson.delete({ where: { id: teacherConflictId } });
  createdLessons.splice(createdLessons.indexOf(teacherConflictId), 1);

  // Participating secondary group conflict must block the new scheduled lesson.
  const groupConflictId = await lesson(outsider.id, g2, occupiedRoom, start, end);
  const blockedGroup = await post(firstSchedule, owner.token, { classroomId: changedRoom });
  check(blockedGroup.status === 409 && blockedGroup.data.lessonId === groupConflictId,
    `Shared group's overlap was accepted: ${JSON.stringify(blockedGroup)}`);
  await prisma.lesson.delete({ where: { id: groupConflictId } });
  createdLessons.splice(createdLessons.indexOf(groupConflictId), 1);
  console.log("PASS: occupied classroom, teacher and shared-group conflicts return 409");

  // A different room number can be selected. The imported room is NEVER rewritten.
  const started = await post(firstSchedule, owner.token, { classroomId: changedRoom });
  check(started.status === 201 && Number.isInteger(started.data.lessonId),
    `Could not replace room 101 with 205: ${JSON.stringify(started)}`);
  createdLessons.push(started.data.lessonId);
  const savedLesson = await prisma.lesson.findUnique({
    where: { id: started.data.lessonId },
    include: { lessonGroups: true },
  });
  check(savedLesson?.classroomId === changedRoom &&
    savedLesson.groupId === g1 &&
    savedLesson.lessonGroups.length === 1 &&
    savedLesson.lessonGroups[0]?.groupId === g2 &&
    savedLesson.sourceScheduleEntryId === firstSchedule,
    "Changed-room shared lecture was not persisted correctly");

  const timetable = await prisma.scheduleEntry.findMany({
    where: { id: { in: [firstSchedule, secondSchedule] } },
  });
  check(timetable.length === 2 &&
    timetable.every((row) => row.classroom === originalName &&
      row.startsAt.getTime() === start.getTime() &&
      row.endsAt.getTime() === end.getTime()),
    "Changing classroom mutated the original imported timetable");
  console.log("PASS: teacher can change scheduled classroom 101 -> 205; timetable unchanged");

  // Repeated start from EITHER group must never modify the created lesson's room.
  const retry = await post(secondSchedule, owner.token, { classroomId: originalRoom });
  check(retry.status === 200 && retry.data.created === false &&
    retry.data.lessonId === savedLesson.id,
    `Retry created another lesson or tried to change room: ${JSON.stringify(retry)}`);

  // Also allow the existing lesson to reopen after the activation window expires.
  await prisma.scheduleEntry.updateMany({
    where: { id: { in: [firstSchedule, secondSchedule] } },
    data: { endsAt: new Date(now - 1000) },
  });
  const lateRetry = await post(firstSchedule, owner.token, { classroomId: occupiedRoom });
  check(lateRetry.status === 200 && lateRetry.data.created === false &&
    lateRetry.data.lessonId === savedLesson.id,
    `Existing lesson did not reopen after scheduled end: ${JSON.stringify(lateRetry)}`);
  const persisted = await prisma.lesson.findUnique({ where: { id: started.data.lessonId } });
  check(persisted?.classroomId === changedRoom &&
    await prisma.lesson.count({ where: { sourceScheduleEntryId: firstSchedule } }) === 1,
    "Retry changed room or duplicated lesson");
  console.log("PASS: repeat start opens the original lesson without changing its classroom");

  // Release the synthetic room blocker before testing the unrelated default
  // schedule; otherwise its teacher/group would still legitimately conflict.
  await prisma.lesson.delete({ where: { id: occupiedId } });
  createdLessons.splice(createdLessons.indexOf(occupiedId), 1);

  // No classroomId: continue using the unique room matching the original timetable.
  const defaultStart = await post(singleSchedule, outsider.token);
  check(defaultStart.status === 201 && Number.isInteger(defaultStart.data.lessonId),
    `Default room resolution failed: ${JSON.stringify(defaultStart)}`);
  createdLessons.push(defaultStart.data.lessonId);
  const defaultLesson = await prisma.lesson.findUnique({ where: { id: defaultStart.data.lessonId } });
  check(defaultLesson?.classroomId === originalRoom,
    "Omitted classroomId did not use the timetable room");
  console.log("PASS: omitting classroomId still uses the original timetable room");
}

async function cleanup() {
  try {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (createdLessons.length) {
      await prisma.attendance.deleteMany({ where: { lessonId: { in: createdLessons } } });
      await prisma.lesson.deleteMany({ where: { id: { in: createdLessons } } });
    }
    if (createdSchedules.length) {
      await prisma.scheduleEntry.deleteMany({ where: { id: { in: createdSchedules } } });
    }
    if (createdUsers.length) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    if (createdRooms.length) await prisma.classroom.deleteMany({ where: { id: { in: createdRooms } } });
    if (createdGroups.length) await prisma.group.deleteMany({ where: { id: { in: createdGroups } } });
    if (disciplineName) await prisma.discipline.delete({ where: { name: disciplineName } });
    console.log("Temporary classroom-switch smoke data cleaned up");
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error("FAIL: scheduled classroom change smoke test", error);
  process.exitCode = 1;
} finally {
  try { await cleanup(); }
  catch (error) { console.error("FAIL: test cleanup", error); process.exitCode = 1; }
}
