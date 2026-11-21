import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import express from "express";
import { prisma } from "../src/prisma.js";
import { generateToken } from "../src/utils/jwt.js";
import scheduleRoutes from "../src/routes/scheduleRoutes.js";

const app = express();
app.use("/api/schedule", scheduleRoutes);
const server = createServer(app);

let scheduleId: number | undefined;
const createdUsers: number[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function getCurrent(token: string, port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/api/schedule/current`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    throw new Error("JWT_SECRET and DATABASE_URL must be set in your local .env");
  }

  const groups = await prisma.group.findMany({
    where: { name: { in: ["4514", "4515"] } },
    select: { id: true, name: true },
  });
  const idByGroup = new Map(groups.map((g) => [g.name, g.id]));
  const group4514 = idByGroup.get("4514");
  const group4515 = idByGroup.get("4515");
  assert(group4514 !== undefined && group4515 !== undefined,
    "Seed groups 4514 and 4515 first");

  const createUser = async (role: "STUDENT" | "TEACHER", groupId: number | null) => {
    const user = await prisma.user.create({
      data: {
        email: `schedule-smoke-${randomUUID()}@example.invalid`,
        password: "smoke-no-login",
        firstName: "Schedule",
        lastName: "Smoke",
        role,
        groupId,
      },
      select: { id: true },
    });
    createdUsers.push(user.id);
    return generateToken(user.id, role);
  };

  const student4514 = await createUser("STUDENT", group4514);
  const student4515 = await createUser("STUDENT", group4515);
  const teacher = await createUser("TEACHER", null);
  const now = Date.now();
  const record = await prisma.scheduleEntry.create({
    data: {
      groupId: group4514,
      discipline: "SMOKE upcoming schedule",
      classroom: "SMOKE (temporary)",
      startsAt: new Date(now + 10 * 60_000),
      endsAt: new Date(now + 90 * 60_000),
    },
    select: { id: true },
  });
  scheduleId = record.id;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  const own = await getCurrent(student4514, port);
  assert(own.status === 200 &&
    Array.isArray(own.body.lessons) &&
    own.body.lessons.some((lesson: { id: number }) => lesson.id === scheduleId),
  `Group 4514 did not see its upcoming class: ${JSON.stringify(own)}`);
  console.log("PASS: upcoming class visible 10 minutes before start for group 4514");

  const other = await getCurrent(student4515, port);
  assert(other.status === 200 &&
    Array.isArray(other.body.lessons) &&
    !other.body.lessons.some((lesson: { id: number }) => lesson.id === scheduleId),
  "Group 4515 unexpectedly received group 4514 schedule entry");
  console.log("PASS: other group cannot see this class");

  const forbidden = await getCurrent(teacher, port);
  assert(forbidden.status === 403, `Expected 403 for teacher, received ${forbidden.status}`);
  console.log("PASS: teacher access denied");
}

async function cleanup() {
  try {
    if (scheduleId) await prisma.scheduleEntry.delete({ where: { id: scheduleId } });
    if (createdUsers.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    }
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error("FAIL: schedule suggestion smoke test", error);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (error) {
    console.error("Failed to clean temporary smoke data:", error);
    process.exitCode = 1;
  }
}
