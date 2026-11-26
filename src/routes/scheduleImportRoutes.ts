import { createHash } from "node:crypto";
import { Router } from "express";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";
import { isAttendanceExcluded } from "../utils/attendanceDisciplinePolicy.js";

const router = Router();
const SUPPORTED = new Set(["4514", "4515", "4516", "4517"]);

type Input = {
  group?: string;
  groups?: string[];
  discipline?: string;
  classroom?: string;
  teacherName?: string;
  teacherEmail?: string;
  startsAt?: string;
  endsAt?: string;
};

function dateTime(raw: unknown): Date | null {
  if (typeof raw !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\+03:00$/.test(raw)) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  // JavaScript normalizes invalid dates such as February 30.
  const day = raw.slice(0, 10);
  const utcCalendar = new Date(day + "T00:00:00Z");
  return utcCalendar.toISOString().slice(0, 10) === day ? date : null;
}

function nonempty(text: unknown): text is string {
  return typeof text === "string" && text.trim().length > 0 && text.trim().length <= 200;
}

// The browser reads one UTF-8 .json file and POSTs { entries: [...] }.
// Deliberately restricted: mass editing the university timetable requires a server-side allowlist.
router.post("/import", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    return res.status(403).json({ message: "Only authorized teachers can import schedules" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId }, select: { email: true, role: true },
    });
    const allowed = new Set(
      (process.env.SCHEDULE_IMPORT_ALLOWED_EMAILS ?? "")
        .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
    );
    if (!user || user.role !== "TEACHER" || !allowed.has(user.email.toLowerCase())) {
      return res.status(403).json({ message: "Schedule import is not enabled for this account" });
    }
    const entries: unknown = req.body?.entries;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 1000) {
      return res.status(400).json({ errors: [{ row: 0, message: "Provide 1–1000 entries" }] });
    }

    const groupRecords = await prisma.group.findMany({
      where: { name: { in: [...SUPPORTED] } }, select: { id: true, name: true },
    });
    const groups = new Map(groupRecords.map((group) => [group.name, group.id]));
    const teachers = await prisma.user.findMany({
      where: { role: "TEACHER" },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const teacherByEmail = new Map(teachers.map((teacher) => [teacher.email.toLowerCase(), teacher]));
    // Preserve explicit teacher assignments when the same timetable JSON is imported again.
    // A given display name may only be inferred if all existing assignments agree.
    const alreadyAssigned = await prisma.scheduleEntry.findMany({
      where: { teacherName: { not: null }, teacherId: { not: null } },
      select: { teacherName: true, teacherId: true },
    });
    const linkedByName = new Map<string, number>();
    const ambiguousNames = new Set<string>();
    for (const item of alreadyAssigned) {
      if (!item.teacherName || item.teacherId === null) continue;
      const current = linkedByName.get(item.teacherName);
      if (current !== undefined && current !== item.teacherId) ambiguousNames.add(item.teacherName);
      else linkedByName.set(item.teacherName, item.teacherId);
    }

    const errors: Array<{ row: number; message: string }> = [];
    const rows: Array<{
      groupId: number; discipline: string; classroom: string;
      startsAt: Date; endsAt: Date; teacherId: number | null;
      teacherName: string | null; sharedKey: string | null;
    }> = [];

    for (const [index, raw] of entries.entries()) {
      const rowNumber = index + 1;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push({ row: rowNumber, message: "Entry must be an object" });
        continue;
      }
      const item = raw as Input;
      const requestedGroups = item.groups ?? (item.group ? [item.group] : []);
      const names = Array.isArray(requestedGroups)
        ? [...new Set(requestedGroups)]
        : [];
      if (names.length === 0 || names.length > 4 ||
          names.some((name) => !SUPPORTED.has(name) || !groups.has(name))) {
        errors.push({ row: rowNumber, message: "groups must contain 1–4 existing groups 4514–4517" });
        continue;
      }
      if (!nonempty(item.discipline) || !nonempty(item.classroom)) {
        errors.push({ row: rowNumber, message: "discipline and classroom are required" });
        continue;
      }
      if (isAttendanceExcluded(item.discipline)) {
        errors.push({ row: rowNumber, message: "Physical education is excluded from attendance tracking" });
        continue;
      }
      if (item.teacherName !== undefined && !nonempty(item.teacherName)) {
        errors.push({ row: rowNumber, message: "teacherName must be nonempty" });
        continue;
      }
      const start = dateTime(item.startsAt);
      const end = dateTime(item.endsAt);
      if (!start || !end || end <= start) {
        errors.push({ row: rowNumber, message: "Use valid startsAt/endsAt ISO 8601 +03:00; end must follow start" });
        continue;
      }
      const teacherEmail = item.teacherEmail?.trim().toLowerCase() ?? "";
      const teacher = teacherEmail ? teacherByEmail.get(teacherEmail) : undefined;
      if (teacherEmail && !teacher) {
        errors.push({ row: rowNumber, message: "teacherEmail must match an existing TEACHER account" });
        continue;
      }
      const teacherName = item.teacherName?.trim() ??
        (teacher ? teacher.lastName + " " + teacher.firstName : null);
      if (!teacherEmail && teacherName && ambiguousNames.has(teacherName)) {
        errors.push({ row: rowNumber, message: "teacherName has multiple linked accounts; specify teacherEmail" });
        continue;
      }
      const resolvedTeacherId = teacher?.id ??
        (!teacherEmail && teacherName ? linkedByName.get(teacherName) ?? null : null);

      const sharedKey = names.length > 1
        ? createHash("sha256").update(JSON.stringify([
            [...names].sort(), item.discipline.trim(), item.classroom.trim(),
            start.toISOString(), end.toISOString(), teacherEmail || teacherName,
          ])).digest("hex")
        : null;
      for (const name of names) {
        rows.push({
          groupId: groups.get(name)!, discipline: item.discipline.trim(),
          classroom: item.classroom.trim(), startsAt: start, endsAt: end,
          teacherId: resolvedTeacherId, teacherName, sharedKey,
        });
      }
    }
    if (errors.length) return res.status(400).json({ errors });

    // Upsert the entire checked batch atomically; retries update instead of duplicating.
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.scheduleEntry.upsert({
          where: {
            groupId_startsAt_discipline_classroom: {
              groupId: row.groupId, startsAt: row.startsAt,
              discipline: row.discipline, classroom: row.classroom,
            },
          },
          create: row,
          update: {
            endsAt: row.endsAt, teacherId: row.teacherId,
            teacherName: row.teacherName, sharedKey: row.sharedKey,
          },
        });
      }
    });
    return res.json({ imported: rows.length, sourceEntries: entries.length });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to import schedule" });
  }
});

export default router;
