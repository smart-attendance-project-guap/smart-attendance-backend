import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { createServer } from "node:http";
import { prisma } from "../src/prisma.js";
import { redisClient, connectRedis } from "../src/redis.js";
import { generateToken } from "../src/utils/jwt.js";
import lessonRoutes from "../src/routes/lessonRoutes.js";
import lessonGuestRoutes from "../src/routes/lessonGuestRoutes.js";
import attendanceRoutes from "../src/routes/attendanceRoutes.js";

// Only this isolated smoke test needs local WebAuthn defaults.
// The production backend still requires its own explicit WebAuthn configuration.
process.env.WEBAUTHN_ORIGIN ||= "http://localhost:3001";
process.env.WEBAUTHN_RP_ID ||= "localhost";

const app = express();
app.use(express.json());
app.use("/api/lessons", lessonGuestRoutes);
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
  const otherTeacher = await makeUser("TEACHER");
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

  const prematureFinish = await request("PATCH", `/api/lessons/${lessonId}/finish`, teacher.token);
  assert(prematureFinish.status === 409,
    "Finishing before scheduled startsAt must be denied");

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

  // Verify location checks independently of a mobile phone's GPS.
  // Classroom coordinates are defined above; synthetic coordinates exercise
  // the actual HTTP endpoint and leave the attendance PENDING.
  const locationPath = `/api/attendance/${a.body.attendance.id}/location`;
  const locationBody = (changes: Record<string, unknown> = {}) => ({
    latitude: 59.929561,
    longitude: 30.296671,
    accuracyMeters: 10,
    capturedAt: new Date().toISOString(),
    ...changes,
  });

  const foreignLocation = await request("POST", locationPath, third.token, locationBody());
  assert(foreignLocation.status === 403,
    `Another student verified someone else's location: HTTP ${foreignLocation.status}`);

  const invalidLocation = await request(
    "POST", locationPath, first.token, locationBody({ accuracyMeters: -1 }),
  );
  assert(invalidLocation.status === 400,
    `Malformed GPS accuracy was not rejected: HTTP ${invalidLocation.status}`);

  const inaccurateLocation = await request(
    "POST", locationPath, first.token, locationBody({ accuracyMeters: 80 }),
  );
  assert(inaccurateLocation.status === 200 &&
    inaccurateLocation.body.locationChecked === false &&
    inaccurateLocation.body.reason === "LOCATION_ACCURACY_TOO_LOW",
    `Inaccurate GPS was accepted: ${JSON.stringify(inaccurateLocation)}`);

  const distantLocation = await request(
    "POST", locationPath, first.token,
    locationBody({ latitude: 59.940000, longitude: 30.296671 }),
  );
  assert(distantLocation.status === 200 &&
    distantLocation.body.locationChecked === false &&
    distantLocation.body.reason === "LOCATION_OUTSIDE_RADIUS",
    `Out-of-radius GPS was accepted: ${JSON.stringify(distantLocation)}`);

  const staleLocation = await request(
    "POST", locationPath, first.token,
    locationBody({ capturedAt: new Date(Date.now() - 60_000).toISOString() }),
  );
  assert(staleLocation.status === 200 &&
    staleLocation.body.locationChecked === false &&
    staleLocation.body.reason === "LOCATION_CAPTURE_TIME_OUTSIDE_WINDOW",
    `Coordinates taken before QR scan were accepted: ${JSON.stringify(staleLocation)}`);

  const goodLocation = await request("POST", locationPath, first.token, locationBody());
  assert(goodLocation.status === 200 &&
    goodLocation.body.locationChecked === true &&
    goodLocation.body.reason === null,
    `Correct nearby coordinates were rejected: ${JSON.stringify(goodLocation)}`);

  const repeatedLocation = await request("POST", locationPath, first.token, locationBody());
  assert(repeatedLocation.status === 200 && repeatedLocation.body.locationChecked === true,
    "Repeated valid location check unexpectedly failed");

  const locationState = await prisma.attendance.findUnique({
    where: { id: a.body.attendance.id },
    select: { status: true, reviewed: true, locationChecked: true, deviceChecked: true },
  });
  assert(locationState?.status === "PENDING" &&
    locationState.reviewed === false &&
    locationState.locationChecked === true &&
    locationState.deviceChecked === false,
    "Location check must not automatically approve an attendance or impersonate WebAuthn");

  const attendances = await request("GET", `/api/attendance/lesson/${lessonId}`, teacher.token);
  const ids = new Set((attendances.body.attendances ?? []).map((item: any) => item.studentId));
  assert(attendances.status === 200 && ids.has(first.id) && ids.has(second.id) && !ids.has(third.id),
    "Teacher attendance list did not include the two allowed students");

  // Negative access-control cases: none of these calls may modify the lesson
  // or marks. They use the same isolated test teacher, students and classroom.
  const unauthenticated = await fetch(
    `http://127.0.0.1:${port}/api/attendance/history`,
    { signal: AbortSignal.timeout(10_000) },
  );
  const invalidJwt = await request("GET", "/api/lessons", "invalid.jwt.token");
  assert(unauthenticated.status === 401 && invalidJwt.status === 401,
    `Missing or invalid JWT was accepted: ${unauthenticated.status}, ${invalidJwt.status}`);

  const studentTeacherRoutes = await Promise.all([
    request("GET", "/api/lessons", first.token),
    request("POST", "/api/lessons", first.token, {}),
    request("PATCH", `/api/lessons/${lessonId}/finish`, first.token),
    request("POST", `/api/lessons/${lessonId}/qr`, first.token),
    request("GET", `/api/attendance/lesson/${lessonId}`, first.token),
    request("PATCH", `/api/attendance/${a.body.attendance.id}/approve`, first.token),
    request("GET", "/api/attendance/teacher/stats", first.token),
    request("POST", `/api/attendance/${a.body.attendance.id}/device/options`, teacher.token),
  ]);
  assert(studentTeacherRoutes.every((response) => response.status === 403),
    `Student/teacher role separation failed: ${studentTeacherRoutes.map((r) => r.status).join(", ")}`);

  const foreignTeacherRoutes = await Promise.all([
    request("GET", `/api/attendance/lesson/${lessonId}`, otherTeacher.token),
    request("PATCH", `/api/attendance/${a.body.attendance.id}/approve`, otherTeacher.token),
    request("PATCH", `/api/attendance/${b.body.attendance.id}/reject`,
      otherTeacher.token, { rejectionReason: "unauthorized" }),
    request("POST", `/api/lessons/${lessonId}/qr`, otherTeacher.token),
    request("PATCH", `/api/lessons/${lessonId}/finish`, otherTeacher.token),
  ]);
  assert(foreignTeacherRoutes.every((response) => response.status === 403),
    `Another teacher accessed this class: ${foreignTeacherRoutes.map((r) => r.status).join(", ")}`);

  const foreignTeacherLessons = await request("GET", "/api/lessons", otherTeacher.token);
  assert(foreignTeacherLessons.status === 200 &&
    Array.isArray(foreignTeacherLessons.body.lessons) &&
    !foreignTeacherLessons.body.lessons.some((lesson: any) => lesson.id === lessonId),
    "Another teacher's lesson list exposed this lesson");

  const ownHistory = await request("GET", "/api/attendance/history", first.token);
  assert(ownHistory.status === 200 &&
    Array.isArray(ownHistory.body.attendances) &&
    ownHistory.body.attendances.some((r: any) => r.id === a.body.attendance.id) &&
    ownHistory.body.attendances.every((r: any) => r.studentId === first.id) &&
    !ownHistory.body.attendances.some((r: any) => r.id === b.body.attendance.id),
    "Student attendance history disclosed another student's marks");

  // Legacy endpoint must not be used to set verification booleans directly.
  const forgedChecks = await fetch(
    `http://127.0.0.1:${port}/api/attendance/${a.body.attendance.id}/checks`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${first.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        faceChecked: true,
        deviceChecked: true,
        locationChecked: true,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  assert(forgedChecks.status === 404 || forgedChecks.status === 410,
    `Client-supplied attendance checks were accepted: HTTP ${forgedChecks.status}`);

  const protectedState = await prisma.attendance.findUnique({
    where: { id: a.body.attendance.id },
    select: { status: true, reviewed: true, deviceChecked: true },
  });
  const protectedLesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { finishedAt: true },
  });
  assert(protectedState?.status === "PENDING" &&
    protectedState.reviewed === false &&
    protectedState.deviceChecked === false &&
    protectedLesson?.finishedAt === null,
    "Unauthorized requests unexpectedly modified attendance or finished lesson");

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

  // Even an enrolled student must not receive the currently active QR secret
  // through their attendance-history endpoint.
  const ownLessonHistory = history.body.attendances.find(
    (record: any) => record.lessonId === lessonId,
  );
  assert(ownLessonHistory?.lesson &&
    !Object.hasOwn(ownLessonHistory.lesson, "qrToken") &&
    !Object.hasOwn(ownLessonHistory.lesson, "qrExpiresAt") &&
    ownLessonHistory.lesson.discipline === discipline.name &&
    ownLessonHistory.lesson.group?.name === "4515",
    "Student history leaked QR secrets or lost non-sensitive lesson metadata");

  // Invite the 4516 student explicitly: guest attendance is separate from 4514/4515 totals.
  const guestUser = await prisma.user.findUnique({
    where: { id: third.id }, select: { email: true },
  });
  assert(guestUser?.email, "Guest user missing");
  const invitation = await request(
    "POST", `/api/lessons/${lessonId}/guests`, teacher.token,
    { studentEmail: guestUser.email },
  );
  assert(invitation.status === 200 && invitation.body.allowed === true,
    "Teacher could not authorize a student from group 4516");

  const guestQr = await request("POST", `/api/lessons/${lessonId}/qr`, teacher.token);
  assert(guestQr.status === 200, "Guest QR could not be refreshed");
  const guestMark = await request(
    "POST", markPath, third.token, { qrToken: guestQr.body.qrToken },
  );
  assert(guestMark.status === 201 && guestMark.body.attendance?.status === "PENDING",
    "Invited guest could not create a pending mark");

  const guestAttendanceList = await request(
    "GET", `/api/attendance/lesson/${lessonId}`, teacher.token,
  );
  const guestRow = guestAttendanceList.body.attendances?.find(
    (row: any) => row.studentId === third.id,
  );
  assert(guestAttendanceList.status === 200 && guestRow?.isGuest === true &&
    guestAttendanceList.body.absentStudents.every((student: any) => student.id !== third.id),
    "Teacher must see the guest separately from enrolled group members");

  // Finishing before the scheduled endsAt counts immediately in all summaries.
  const finished = await request("PATCH", `/api/lessons/${lessonId}/finish`, teacher.token);
  assert(finished.status === 200, "Teacher could not finish the temporary lesson");

  const earlyStats = await request("GET", "/api/attendance/teacher/stats", teacher.token);
  assert(earlyStats.status === 200 &&
    earlyStats.body.totalLessons === 1 &&
    earlyStats.body.attendedStudents === 0,
    "Early finish must count immediately, but PENDING is not yet approved");

  const earlyStudentStats = await request("GET", "/api/attendance/stats", second.token);
  assert(earlyStudentStats.status === 200 &&
    earlyStudentStats.body.totalLessons === 1 &&
    earlyStudentStats.body.attendedLessons === 0 &&
    earlyStudentStats.body.missedLessons === 1,
    "Student stats must include early-finished lesson, even before review");

  const closedQr = await request("POST", `/api/lessons/${lessonId}/qr`, teacher.token);
  assert(closedQr.status === 400, "QR must stay closed after early finish");

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

  const teacherStats = await request("GET", "/api/attendance/teacher/stats", teacher.token);
  assert(teacherStats.status === 200 &&
    teacherStats.body.totalLessons === 1 &&
    teacherStats.body.attendedStudents === 1,
    "Teacher summary must count exactly one approved mark in the shared lecture");

  const approvedGuest = await request(
    "PATCH", `/api/attendance/${guestMark.body.attendance.id}/approve`, teacher.token,
  );
  assert(approvedGuest.status === 200 &&
    ["PRESENT", "LATE"].includes(approvedGuest.body.attendance?.status),
    "Guest pending mark must still be approvable after lesson finish");

  const statsWithGuest = await request("GET", "/api/attendance/teacher/stats", teacher.token);
  const lessonStatsWithGuest = await request(
    "GET", "/api/attendance/teacher/lessons/stats", teacher.token,
  );
  const sharedStats = lessonStatsWithGuest.body.stats?.find(
    (row: any) => row.lessonId === lessonId,
  );
  assert(statsWithGuest.status === 200 &&
    statsWithGuest.body.attendedStudents === 1 &&
    statsWithGuest.body.guestAttendedStudents === 1 &&
    statsWithGuest.body.attendancePercentage ===
      Number((100 / statsWithGuest.body.totalStudents).toFixed(2)) &&
    lessonStatsWithGuest.status === 200 &&
    sharedStats?.attendedStudents === 1 &&
    sharedStats?.guestAttendedStudents === 1 &&
    sharedStats?.attendancePercentage ===
      Number((100 / sharedStats.totalStudents).toFixed(2)),
    "Guest attendance must not inflate official group percentages");
  console.log("PASS: authorized guest counted separately, not in group percentage");

  const groupStats = await request("GET", "/api/attendance/teacher/groups/stats", teacher.token);
  const byGroup = new Map<string, any>(
    (groupStats.body.stats ?? []).map((item: any) => [item.groupName, item]),
  );
  assert(groupStats.status === 200 &&
    byGroup.get("4514")?.totalLessons === 1 &&
    byGroup.get("4514")?.attendedStudents === 1 &&
    byGroup.get("4515")?.totalLessons === 1 &&
    byGroup.get("4515")?.attendedStudents === 0 &&
    !byGroup.has("4516"),
    "Shared lecture teacher stats must exclude the invited guest's home group");

  const studentStats = await request("GET", "/api/attendance/stats", second.token);
  assert(studentStats.status === 200 &&
    studentStats.body.rejectedLessons >= 1 &&
    studentStats.body.attendedLessons === 0,
    "Group 4515 rejected mark must appear in its own student statistics");

  console.log("PASS: four-group limit includes primary group");
  console.log("PASS: duplicate scan does not create an extra mark");
  console.log("PASS: group 4515 attendance history displays 4515");
  console.log("PASS: student attendance history never exposes active QR secrets");
  console.log("PASS: early finish immediately counts in stats, QR closed, PENDING review remains possible");
  console.log("PASS: teacher approval/rejection and per-group stats");
  console.log("PASS: group 4515 sees its rejection in student stats");

  console.log("PASS: common lesson created for 4514 and 4515");
  console.log("PASS: same QR accepted for both allowed groups");
  console.log("PASS: 4516 student denied with HTTP 403");
  console.log("PASS: teacher sees both attendance records");
  console.log("PASS: WebAuthn requires registered key and attendance ownership");
  console.log("PASS: location check rejects another student's attendance");
  console.log("PASS: malformed and inaccurate location data rejected");
  console.log("PASS: coordinates beyond classroom radius rejected");
  console.log("PASS: location captured before QR scan rejected");
  console.log("PASS: valid coordinates confirmed without auto-approving");
  console.log("PASS: repeated location verification stays idempotent");
  console.log("PASS: missing or forged JWT rejected with HTTP 401");
  console.log("PASS: students cannot call teacher endpoints or use teacher WebAuthn identity");
  console.log("PASS: another teacher cannot access or modify a lesson");
  console.log("PASS: teacher lesson lists and student attendance history are isolated");
  console.log("PASS: client cannot forge device verification or alter approval state");
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
