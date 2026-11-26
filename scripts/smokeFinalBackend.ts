// Run only with DATABASE_URL pointing to smart_attendance_mvp_test.
// This smoke test creates isolated, uniquely named data, then removes only its own records.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { prisma } from "../src/prisma.js";
import { generateToken } from "../src/utils/jwt.js";
import attendanceExportRoutes from "../src/routes/attendanceExportRoutes.js";
import scheduleImportRoutes from "../src/routes/scheduleImportRoutes.js";

const database = new URL(process.env.DATABASE_URL ?? "postgres://invalid:invalid@localhost/invalid").pathname;
if (database !== "/smart_attendance_mvp_test") {
  console.error("STOP: run on smart_attendance_mvp_test ONLY. Current DB:", database);
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error("STOP: JWT_SECRET not set");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs") as typeof import("exceljs");
const tag = randomUUID().slice(0, 12);
const excelDiscipline = `SMOKE Excel ${tag}`;
const importDiscipline = `SMOKE Import ${tag}`;
const classroomName = `SMOKE-${tag}`;
const userIds: number[] = [];
const lessonIds: number[] = [];
let classroomId: number | null = null;
let server = createServer();
const previousAllowlist = process.env.SCHEDULE_IMPORT_ALLOWED_EMAILS;

function check(ok: unknown, message: string): asserts ok {
  assert.ok(ok, message);
}

async function main() {
  const group4515 = await prisma.group.findFirst({ where: { name: "4515" } });
  const group4514 = await prisma.group.findFirst({ where: { name: "4514" } });
  check(group4515 && group4514, "Seed groups 4514 and 4515 before testing");

  const createUser = async (role: "TEACHER" | "STUDENT", label: string, groupId: number | null) => {
    const user = await prisma.user.create({
      data: {
        firstName: label,
        lastName: `SMOKE${tag}`,
        email: `${label.toLowerCase()}-${tag}@example.invalid`,
        password: "no-login-smoke-only",
        role,
        groupId,
      },
    });
    userIds.push(user.id);
    return user;
  };
  const teacher = await createUser("TEACHER", "Teacher", null);
  const a = await createUser("STUDENT", "Alpha", group4515.id);
  const b = await createUser("STUDENT", "Beta", group4515.id);
  const guest = await createUser("STUDENT", "Guest", group4514.id);

  const room = await prisma.classroom.create({
    data: { name: classroomName, latitude: 59.929561, longitude: 30.296671 },
  });
  classroomId = room.id;

  const now = Date.now();
  const days = 86_400_000;
  for (let i = 0; i < 3; i++) {
    const start = new Date(now - (5 - i) * days);
    const end = new Date(start.getTime() + 90 * 60_000);
    const lesson = await prisma.lesson.create({
      data: {
        teacherId: teacher.id,
        groupId: group4515.id,
        classroomId: room.id,
        discipline: excelDiscipline,
        startsAt: start,
        endsAt: end,
        finishedAt: end,
      },
    });
    lessonIds.push(lesson.id);
  }
  await prisma.attendance.createMany({
    data: [
      { lessonId: lessonIds[0], studentId: a.id, status: "PRESENT" },
      { lessonId: lessonIds[1], studentId: a.id, status: "LATE" },
      { lessonId: lessonIds[0], studentId: b.id, status: "REJECTED" },
      { lessonId: lessonIds[1], studentId: b.id, status: "PENDING" },
    ],
  });

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use("/api/attendance", attendanceExportRoutes);
  app.use("/api/schedule", scheduleImportRoutes);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const teacherToken = generateToken(teacher.id, "TEACHER");
  const studentToken = generateToken(a.id, "STUDENT");
  const query = new URLSearchParams({
    groupId: String(group4515.id),
    discipline: excelDiscipline,
    from: new Date(now - 8 * days).toISOString().slice(0, 10),
    to: new Date(now + days).toISOString().slice(0, 10),
  });
  const exportUrl = `${origin}/api/attendance/teacher/export?${query}`;
  const download = await fetch(exportUrl, { headers: { Authorization: `Bearer ${teacherToken}` } });
  if (download.status !== 200) throw new Error(`Excel HTTP ${download.status}: ${await download.text()}`);
  check((download.headers.get("content-type") ?? "").includes("spreadsheetml"), "Excel content-type missing");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await download.arrayBuffer()));
  const sheet = book.getWorksheet("Посещаемость");
  check(sheet, "Excel worksheet missing");
  const rowFor = (firstName: string) => {
    for (let index = 6; index <= sheet.rowCount; index++) {
      const row = sheet.getRow(index);
      if (row.getCell(1).text === `SMOKE${tag} ${firstName}`) return row;
    }
    throw new Error(`Excel student ${firstName} missing`);
  };
  const alphaRow = rowFor("Alpha");
  const betaRow = rowFor("Beta");
  check(alphaRow.getCell(5).value === 2 && alphaRow.getCell(6).value === 1,
    `Wrong totals for Alpha: ${alphaRow.getCell(5).text}/${alphaRow.getCell(6).text}, expected 2/1`);
  check(betaRow.getCell(5).value === 0 && betaRow.getCell(6).value === 3,
    `Wrong totals for Beta: ${betaRow.getCell(5).text}/${betaRow.getCell(6).text}, expected 0/3`);
  check(alphaRow.getCell(2).text === "Присутствовал" && alphaRow.getCell(3).text === "Опоздал" && alphaRow.getCell(4).text === "Пропуск", "Wrong Alpha status labels");
  check(betaRow.getCell(2).text === "Отклонено" && betaRow.getCell(3).text === "Ожидает проверки" && betaRow.getCell(4).text === "Пропуск", "Wrong Beta status labels");
  console.log("PASS: Excel totals and statuses: Alpha 2/1, Beta 0/3");
  // Early finish immediately changes the Excel denominator, even before endsAt.
  const earlyLesson = await prisma.lesson.create({
    data: {
      teacherId: teacher.id,
      groupId: group4515.id,
      classroomId: room.id,
      discipline: excelDiscipline,
      startsAt: new Date(now - 20 * 60_000),
      endsAt: new Date(now + 70 * 60_000),
      finishedAt: new Date(now - 60_000),
    },
  });
  lessonIds.push(earlyLesson.id);
  await prisma.lessonGuest.create({
    data: { lessonId: earlyLesson.id, studentId: guest.id },
  });
  await prisma.attendance.create({
    data: { lessonId: earlyLesson.id, studentId: guest.id, status: "PRESENT" },
  });
  const earlyDownload = await fetch(exportUrl, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  check(earlyDownload.status === 200, `Early-finish Excel HTTP ${earlyDownload.status}`);
  const earlyBook = new ExcelJS.Workbook();
  await earlyBook.xlsx.load(Buffer.from(await earlyDownload.arrayBuffer()));
  const earlySheet = earlyBook.getWorksheet("Посещаемость");
  check(earlySheet, "Early-finish Excel worksheet missing");
  const earlyAlpha = earlySheet.getRow(alphaRow.number);
  const earlyBeta = earlySheet.getRow(betaRow.number);
  check(earlyAlpha.getCell(5).text === "Пропуск" &&
    earlyAlpha.getCell(6).value === 2 && earlyAlpha.getCell(7).value === 2 &&
    earlyBeta.getCell(6).value === 0 && earlyBeta.getCell(7).value === 4,
    "Early-finished lesson must immediately count as missed in Excel totals");
  console.log("PASS: early finish counts in Excel, while outside-group guest is excluded");


  const studentExport = await fetch(exportUrl, { headers: { Authorization: `Bearer ${studentToken}` } });
  check(studentExport.status === 403, `Student Excel access should be 403, got ${studentExport.status}`);
  console.log("PASS: student cannot download teacher Excel");

  const importUrl = `${origin}/api/schedule/import`;
  const sendImport = async (entries: unknown[]) => {
    const res = await fetch(importUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${teacherToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    return { status: res.status, data: await res.json() };
  };
  delete process.env.SCHEDULE_IMPORT_ALLOWED_EMAILS;
  const validEntry = {
    groups: ["4514", "4515"],
    discipline: importDiscipline,
    classroom: classroomName,
    teacherEmail: teacher.email,
    startsAt: "2027-01-20T10:00:00+03:00",
    endsAt: "2027-01-20T11:30:00+03:00",
  };
  const forbidden = await sendImport([validEntry]);
  check(forbidden.status === 403, `Import without allowlist should be 403, got ${forbidden.status}`);
  process.env.SCHEDULE_IMPORT_ALLOWED_EMAILS = teacher.email;
  const invalid = await sendImport([{ ...validEntry, endsAt: "BAD" }]);
  check(invalid.status === 400 && Array.isArray(invalid.data.errors) && invalid.data.errors[0]?.row === 1,
    `Bad schedule should give row 1 HTTP 400, got ${invalid.status}`);
  check(await prisma.scheduleEntry.count({ where: { discipline: importDiscipline } }) === 0,
    "Invalid schedule wrote to database");
  const first = await sendImport([validEntry]);
  const second = await sendImport([validEntry]);
  check(first.status === 200 && first.data.imported === 2 && first.data.sourceEntries === 1,
    `First schedule import wrong: ${JSON.stringify(first)}`);
  check(second.status === 200 && second.data.imported === 2 && second.data.sourceEntries === 1,
    `Repeated schedule import wrong: ${JSON.stringify(second)}`);
  const saved = await prisma.scheduleEntry.findMany({ where: { discipline: importDiscipline } });
  check(saved.length === 2 && saved.every((row) => row.teacherId === teacher.id && Boolean(row.sharedKey)),
    `Schedule upsert/shared teacher assignment wrong, rows: ${saved.length}`);
  console.log("PASS: schedule import authorization, row errors, 2 shared-group records, no duplicates");
  console.log("PASS: FINAL BACKEND EXCEL & SCHEDULE API SMOKE");
}

try {
  await main();
} catch (error) {
  console.error("FAIL:", error);
  process.exitCode = 1;
} finally {
  if (server.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (previousAllowlist === undefined) delete process.env.SCHEDULE_IMPORT_ALLOWED_EMAILS;
  else process.env.SCHEDULE_IMPORT_ALLOWED_EMAILS = previousAllowlist;
  try {
    await prisma.scheduleEntry.deleteMany({ where: { discipline: importDiscipline } });
    if (lessonIds.length) {
      await prisma.attendance.deleteMany({ where: { lessonId: { in: lessonIds } } });
      await prisma.lesson.deleteMany({ where: { id: { in: lessonIds } } });
    }
    if (classroomId !== null) await prisma.classroom.delete({ where: { id: classroomId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    console.log("Temporary test data removed");
  } catch (error) {
    console.error("WARNING: test cleanup failed; report this error:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
