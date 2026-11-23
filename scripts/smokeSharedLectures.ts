import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { createServer } from "node:http";
import { prisma } from "../src/prisma.js";
import { redisClient, connectRedis } from "../src/redis.js";
import { generateToken } from "../src/utils/jwt.js";
import lessonRoutes from "../src/routes/lessonRoutes.js";
import attendanceRoutes from "../src/routes/attendanceRoutes.js";

// Only this isolated smoke test needs local WebAuthn defaults.
// The production backend still requires its own explicit WebAuthn configuration.
process.env.WEBAUTHN_ORIGIN ||= "http://localhost:3001";
process.env.WEBAUTHN_RP_ID ||= "localhost";

const app = express();
app.use(express.json());
app.use("/api/lessons", lessonRoutes);
app.use("/api/attendance", attendanceRoutes);
const server = createServer(app);

let lessonId: number | undefined;
let classroomId: number | undefined;
const userIds: number[] = [];
let port = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function request(
  method: string,
  path: string,
  token: string,
  data?: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const groupNames = ["4514", "4515", "4516"];
  const groups = await prisma.group.findMany({
    where: { name: { in: groupNames } },
    select: { id: true, name: true },
  });
  const byName = new Map(groups.map((g) => [g.name, g.id]));
  const [g1, g2, outsider] = groupNames.map((name) => byName.get(name));
  assert(g1 !== undefined && g2 !== undefined && outsider !== undefined,
    "First seed groups with npx.cmd tsx scripts/seedUniversityReferences.ts");

  const discipline = await prisma.discipline.findFirst({
    select: { name: true },
  });
  assert(discipline, "No disciplines found in local DB");

  const now = Date.now();
  const unique = randomUUID();
  const makeUser = async (role: "TEACHER" | "STUDENT", groupId?: number) => {
    const user = await prisma.user.create({
      data: {
        email: `shared-smoke-${randomUUID()}@example.invalid`,
        password: "test-account-no-login",
        firstName: "Smoke",
        lastName: role,
        role,
        groupId: groupId ?? null,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return { id: user.id, token: generateToken(user.id, role) };
  };

  const teacher = await makeUser("TEACHER");
  const first = await makeUser("STUDENT", g1);
  const second = await makeUser("STUDENT", g2);
  const third = await makeUser("STUDENT", outsider);

  const classroom = await prisma.classroom.create({
    data: {
      name: `SMOKE-${unique.slice(0, 8)}`,
      latitude: 59.929561,
      longitude: 30.296671,
    },
    select: { id: true },
  });
  classroomId = classroom.id;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;

  // Create lesson through the REAL teacher endpoint, far from existing classes.
  const created = await request("POST", "/api/lessons", teacher.token, {
    discipline: discipline.name,
    groupId: g1,
    groupIds: [g1, g2],
    classroomId,
    startsAt: new Date(Date.UTC(2027, 5, 25, 11, 0)).toISOString(),
    endsAt: new Date(Date.UTC(2027, 5, 25, 12, 30)).toISOString(),
  });
  assert(created.status === 201 && Number.isInteger(created.body.lesson?.id),
    `Shared lesson creation failed: ${created.status} ${JSON.stringify(created.body)}`);
  lessonId = created.body.lesson.id;

  const members = await prisma.lessonGroup.findMany({
    where: { lessonId },
    select: { groupId: true },
  });
  assert(members.length === 1 && members[0]?.groupId === g2,
    "Second group was not linked to the lesson");

  // Move only this temporary class into an active window to exercise QR marking.
  await prisma.lesson.update({
    where: { id: lessonId },
    data: {
      startsAt: new Date(now - 60_000),
      endsAt: new Date(now + 10 * 60_000),
    },
  });
  const qr = await request("POST", `/api/lessons/${lessonId}/qr`, teacher.token);
  assert(qr.status === 200 && typeof qr.body.qrToken === "string",
    `QR creation failed: ${qr.status}`);

  const markPath = `/api/attendance/${lessonId}/mark`;
  const payload = { qrToken: qr.body.qrToken };

  const a = await request("POST", markPath, first.token, payload);
  assert(a.status === 201 && a.body.attendance?.status === "PENDING",
    `Group 4514 attendance failed: ${a.status} ${JSON.stringify(a.body)}`);
  const b = await request("POST", markPath, second.token, payload);
  assert(b.status === 201 && b.body.attendance?.status === "PENDING",
    `Group 4515 attendance failed: ${b.status} ${JSON.stringify(b.body)}`);
  const c = await request("POST", markPath, third.token, payload);
  assert(c.status === 403,
    `OUTSIDER was not forbidden: ${c.status} ${JSON.stringify(c.body)}`);

  // WebAuthn endpoints must be tied to the owner of this PENDING attendance.
  const ownedOptions = await request(
    "POST", `/api/attendance/${a.body.attendance.id}/device/options`, first.token,
  );
  assert(ownedOptions.status === 409 &&
    ownedOptions.body.code === "NO_REGISTERED_CREDENTIAL",
    `Unregistered student must not bypass WebAuthn enrolment: HTTP ${ownedOptions.status}, ${JSON.stringify(ownedOptions.body)}`);

  const anotherStudentOptions = await request(
    "POST", `/api/attendance/${a.body.attendance.id}/device/options`, second.token,
  );
  assert(anotherStudentOptions.status === 403,
    `Student from another group must not verify someone else's attendance: HTTP ${anotherStudentOptions.status}, ${JSON.stringify(anotherStudentOptions.body)}`);

  const attendances = await request("GET", `/api/attendance/lesson/${lessonId}`, teacher.token);
  const ids = new Set((attendances.body.attendances ?? []).map((item: any) => item.studentId));
  assert(attendances.status === 200 && ids.has(first.id) && ids.has(second.id) && !ids.has(third.id),
    "Teacher attendance list did not include the two allowed students");

  // The primary group plus four distinct additional IDs must be rejected,
  // even when the optional array itself contains only four elements.
  const tooManyGroups = await request("POST", "/api/lessons", teacher.token, {
    discipline: discipline.name,
    groupId: g1,
    groupIds: [g2, outsider, 999998, 999999],
    classroomId,
    startsAt: new Date(Date.UTC(2027, 5, 26, 11, 0)).toISOString(),
    endsAt: new Date(Date.UTC(2027, 5, 26, 12, 30)).toISOString(),
  });
  assert(tooManyGroups.status === 400 &&
    tooManyGroups.body.message === "A lesson can contain no more than four groups",
    "The four-group limit must include the primary group");

  const duplicate = await request("POST", markPath, first.token, payload);
  assert([400, 409].includes(duplicate.status),
    "Repeated QR scan must not create a second attendance");

  const history = await request("GET", "/api/attendance/history", second.token);
  assert(history.status === 200 && history.body.attendances.some(
    (record: any) =>
      record.lessonId === lessonId &&
      record.lesson?.group?.name === "4515",
  ), "Group 4515 history must display the student's own group");

  // A teacher may finish early, but statistics must wait until endsAt.
  const finished = await request("PATCH", `/api/lessons/${lessonId}/finish`, teacher.token);
  assert(finished.status === 200, "Teacher could not finish the temporary lesson");

  const earlyStats = await request("GET", "/api/attendance/teacher/stats", teacher.token);
  assert(earlyStats.status === 200 && earlyStats.body.totalLessons === 0,
    "A prematurely finished lesson must not enter final statistics");

  // Approval must be blocked until WebAuthn has been server-verified.
  const withoutWebAuthn = await request(
    "PATCH", `/api/attendance/${a.body.attendance.id}/approve`, teacher.token,
  );
  assert(
    withoutWebAuthn.status === 409 &&
    withoutWebAuthn.body.code === "DEVICE_VERIFICATION_REQUIRED",
    `Teacher approved PENDING without WebAuthn: HTTP ${withoutWebAuthn.status} ${JSON.stringify(withoutWebAuthn.body)}`,
  );
  const stillPending = await prisma.attendance.findUnique({
    where: { id: a.body.attendance.id },
    select: { status: true, reviewed: true, deviceChecked: true },
  });
  assert(stillPending?.status === "PENDING" &&
    stillPending.reviewed === false &&
    stillPending.deviceChecked === false,
    "Rejected premature approval must not alter attendance");

  // Simulate the verified result for the approval-endpoint smoke test only.
  // This direct DB update does NOT test or replace a real WebAuthn ceremony;
  // the real WebAuthn handler is separately responsible for setting this flag.
  await prisma.attendance.update({
    where: { id: a.body.attendance.id },
    data: { deviceChecked: true },
  });

  const approved = await request(
    "PATCH", `/api/attendance/${a.body.attendance.id}/approve`, teacher.token,
  );
  assert(approved.status === 200 && approved.body.attendance?.status === "PRESENT",
    "Teacher could not approve group 4514 attendance");

  const rejected = await request(
    "PATCH", `/api/attendance/${b.body.attendance.id}/reject`, teacher.token,
    { rejectionReason: "SMOKE test rejection" },
  );
  assert(rejected.status === 200 && rejected.body.attendance?.status === "REJECTED",
    "Teacher could not reject group 4515 attendance");

  // Advance only this temporary lesson beyond endsAt for final-stats checks.
  await prisma.lesson.update({
    where: { id: lessonId },
    data: { endsAt: new Date(Date.now() - 1000) },
  });

  const teacherStats = await request("GET", "/api/attendance/teacher/stats", teacher.token);
  assert(teacherStats.status === 200 &&
    teacherStats.body.totalLessons === 1 &&
    teacherStats.body.attendedStudents === 1,
    "Teacher summary must count exactly one approved mark in the shared lecture");

  const groupStats = await request("GET", "/api/attendance/teacher/groups/stats", teacher.token);
  const byGroup = new Map<string, any>(
    (groupStats.body.stats ?? []).map((item: any) => [item.groupName, item]),
  );
  assert(groupStats.status === 200 &&
    byGroup.get("4514")?.totalLessons === 1 &&
    byGroup.get("4514")?.attendedStudents === 1 &&
    byGroup.get("4515")?.totalLessons === 1 &&
    byGroup.get("4515")?.attendedStudents === 0,
    "Shared lecture teacher stats must be split correctly by group");

  const studentStats = await request("GET", "/api/attendance/stats", second.token);
  assert(studentStats.status === 200 &&
    studentStats.body.rejectedLessons >= 1 &&
    studentStats.body.attendedLessons === 0,
    "Group 4515 rejected mark must appear in its own student statistics");

  console.log("PASS: four-group limit includes primary group");
  console.log("PASS: duplicate scan does not create an extra mark");
  console.log("PASS: group 4515 attendance history displays 4515");
  console.log("PASS: early finish excluded until scheduled end");
  console.log("PASS: teacher cannot approve without WebAuthn");
  console.log("PASS: teacher approval/rejection and per-group stats");
  console.log("PASS: group 4515 sees its rejection in student stats");

  console.log("PASS: common lesson created for 4514 and 4515");
  console.log("PASS: same QR accepted for both allowed groups");
  console.log("PASS: 4516 student denied with HTTP 403");
  console.log("PASS: teacher sees both attendance records");
  console.log("PASS: WebAuthn requires registered key and attendance ownership");
  console.log("Temporary data cleanup starts automatically.");
}

async function cleanup() {
  try {
    if (lessonId) {
      await prisma.attendance.deleteMany({ where: { lessonId } });
      await prisma.lesson.delete({ where: { id: lessonId } });
      if (redisClient.isOpen) await redisClient.del(`lesson:${lessonId}:qr`);
    }
    if (classroomId) await prisma.classroom.delete({ where: { id: classroomId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (redisClient.isOpen) await redisClient.quit();
    await prisma.$disconnect();
  }
}

try {
  if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    throw new Error("JWT_SECRET and DATABASE_URL must be set");
  }
  await connectRedis();
  await main();
} catch (error) {
  console.error("FAIL: shared lecture smoke test", error);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error("Cleanup failed; inspect only temporary SMOKE records:", cleanupError);
    process.exitCode = 1;
  }
}
