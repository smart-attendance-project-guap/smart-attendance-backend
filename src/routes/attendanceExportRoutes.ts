import { Router } from "express";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";
import { makeXlsx } from "../utils/makeXlsx.js";
import { isAttendanceExcluded } from "../utils/attendanceDisciplinePolicy.js";

const router = Router();
const MAX_DAYS = 180;

function day(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const check = new Date(value + "T00:00:00Z");
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== value) return null;
  return new Date(value + "T00:00:00+03:00");
}

function label(status: string | undefined, completed: boolean, upcoming: boolean): string {
  switch (status) {
    case "PRESENT": return "Присутствовал";
    case "LATE": return "Опоздал";
    case "PENDING": return "Ожидает проверки";
    case "REJECTED": return "Отклонено";
    default: return completed ? "Пропуск" : upcoming ? "Занятие впереди" : "Нет отметки";
  }
}

// GET /api/attendance/teacher/export?groupId=2&discipline=...&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/teacher/export", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    return res.status(403).json({ message: "Only teachers may export attendance" });
  }
  const group = req.query.groupId;
  const discipline = req.query.discipline;
  const fromRaw = req.query.from;
  const toRaw = req.query.to;
  const from = day(fromRaw);
  const to = day(toRaw);
  const groupId = typeof group === "string" && /^[1-9]\d*$/.test(group) ? Number(group) : 0;
  if (!Number.isSafeInteger(groupId) || !from || !to ||
      typeof discipline !== "string" || !discipline.trim() ||
      to.getTime() < from.getTime() ||
      to.getTime() - from.getTime() > MAX_DAYS * 86_400_000) {
    return res.status(400).json({ message: "Provide valid groupId, discipline, from and to (max 180 days)" });
  }

  if (isAttendanceExcluded(discipline)) {
    return res.status(400).json({ message: "Physical education is excluded from attendance exports" });
  }
  try {
    const selectedGroup = await prisma.group.findUnique({
      where: { id: groupId }, select: { id: true, name: true },
    });
    if (!selectedGroup) return res.status(404).json({ message: "Group not found" });

    // A teacher must have their own lesson for this group/discipline.
    const ownLesson = await prisma.lesson.findFirst({
      where: {
        teacherId: req.user.userId,
        discipline: discipline.trim(),
        OR: [
          { groupId },
          { lessonGroups: { some: { groupId } } },
        ],
      },
      select: { id: true },
    });
    if (!ownLesson) return res.status(403).json({ message: "No access to this group's attendance" });

    const endExclusive = new Date(to.getTime() + 86_400_000);
    const lessons = await prisma.lesson.findMany({
      where: {
        teacherId: req.user.userId,
        discipline: discipline.trim(),
        startsAt: { gte: from, lt: endExclusive },
        OR: [
          { groupId },
          { lessonGroups: { some: { groupId } } },
        ],
      },
      select: {
        id: true, startsAt: true, endsAt: true, finishedAt: true,
        attendances: {
          where: { student: { groupId } },
          select: { studentId: true, status: true },
        },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    if (lessons.length > 16_000) return res.status(400).json({ message: "Too many lessons for one Excel sheet" });

    const students = await prisma.user.findMany({
      where: { role: "STUDENT", groupId },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    });

    const now = Date.now();
    const header = ["Студент",
      ...lessons.map((lesson) => new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
        year: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(lesson.startsAt)),
      "Посещений", "Пропусков"];

    const rows: Array<Array<string | number>> = [
      ["Группа: " + selectedGroup.name],
      ["Дисциплина: " + discipline.trim()],
      ["Период: " + fromRaw + " — " + toRaw],
      ["Посещения — только подтверждённые; пропуски — после планового конца пары. Ожидающие отметки не считаются пропусками."],
      header,
    ];
    for (const student of students) {
      let attended = 0;
      let missed = 0;
      const values = lessons.map((lesson) => {
        const record = lesson.attendances.find((entry) => entry.studentId === student.id);
        const completed = lesson.finishedAt !== null;
        const scheduledEndReached = lesson.endsAt.getTime() <= now;
        const present = record?.status === "PRESENT" || record?.status === "LATE";
        if (completed) {
          if (present) attended++;
          // Pending marks stay under review, never a confirmed absence.
          else if (scheduledEndReached && (record === undefined || record.status === "REJECTED")) missed++;
        }
        return label(record?.status, completed && scheduledEndReached, lesson.startsAt.getTime() > now);
      });
      rows.push([student.lastName + " " + student.firstName, ...values, attended, missed]);
    }

    const file = await makeXlsx(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"attendance-" + selectedGroup.name.replace(/[^0-9A-Za-z_-]/g, "_") + ".xlsx\"");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(file);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to export attendance" });
  }
});

export default router;
