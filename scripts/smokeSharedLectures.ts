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

  const attendances = await request("GET", `/api/attendance/lesson/${lessonId}`, teacher.token);
  const ids = new Set((attendances.body.attendances ?? []).map((item: any) => item.studentId));
  assert(attendances.status === 200 && ids.has(first.id) && ids.has(second.id) && !ids.has(third.id),
    "Teacher attendance list did not include the two allowed students");

  console.log("PASS: common lesson created for 4514 and 4515");
  console.log("PASS: same QR accepted for both allowed groups");
  console.log("PASS: 4516 student denied with HTTP 403");
  console.log("PASS: teacher sees both attendance records");
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
