import { Router } from "express";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";

const router = Router();
const LOOKAHEAD_MINUTES = 30;

function positiveId(raw: unknown): number | null {
  const value = typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(value) ? value : null;
}

router.get("/suggestions", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.user || !["STUDENT", "TEACHER"].includes(req.user.role)) {
    return res.status(403).json({ message: "Access denied" });
  }
  try {
    const now = new Date();
    const until = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60_000);
    const student = req.user.role === "STUDENT" ? await prisma.user.findUnique({
      where: { id: req.user.userId }, select: { groupId: true },
    }) : null;
    if (req.user.role === "STUDENT" && !student) {
      return res.status(404).json({ message: "Student not found" });
    }
    if (req.user.role === "STUDENT" && student?.groupId === null) {
      return res.json({ suggestions: [] });
    }

    const visible = await prisma.scheduleEntry.findMany({
      where: {
        startsAt: { lte: until }, endsAt: { gt: now },
        ...(req.user.role === "STUDENT"
          ? { groupId: student!.groupId! }
          : { teacherId: req.user.userId }),
      },
      include: { group: { select: { id: true, name: true } } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    const keys = visible.map((entry) => entry.sharedKey).filter((key): key is string => Boolean(key));
    const siblings = keys.length
      ? await prisma.scheduleEntry.findMany({
          where: { sharedKey: { in: [...new Set(keys)] } },
          include: { group: { select: { id: true, name: true } } },
        })
      : [];
    const all = [...visible, ...siblings];
    const result = visible.map((entry) => {
      const related = entry.sharedKey
        ? all.filter((other) => other.sharedKey === entry.sharedKey)
        : [entry];
      const canonicalId = Math.min(...related.map((item) => item.id));
      return {
        id: entry.id,
        scheduleEntryId: entry.id,
        canonicalScheduleId: canonicalId,
        discipline: entry.discipline,
        teacherId: entry.teacherId,
        teacherName: entry.teacherName,
        classroom: entry.classroom,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        groups: related.map((item) => item.group).filter((group, index, items) =>
          items.findIndex((existing) => existing.id === group.id) === index),
      };
    });
    const unique = result.filter((entry, index, entries) =>
      entries.findIndex((item) => item.canonicalScheduleId === entry.canonicalScheduleId) === index);
    return res.json({ suggestions: unique });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to get schedule suggestions" });
  }
});

// Teacher activates an imported suggestion. One source ID can produce at most one lesson.
router.post("/:id/start", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    return res.status(403).json({ message: "Only teachers may start a lesson" });
  }
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid schedule entry ID" });
  try {
    const schedule = await prisma.scheduleEntry.findUnique({ where: { id } });
    if (!schedule) return res.status(404).json({ message: "Schedule entry not found" });
    if (schedule.teacherId !== req.user.userId) {
      return res.status(403).json({ message: "Not your scheduled lesson" });
    }
    const now = Date.now();
    if (schedule.startsAt.getTime() - now > LOOKAHEAD_MINUTES * 60_000 ||
        schedule.endsAt.getTime() <= now) {
      return res.status(409).json({ message: "Lesson may be started only within its 30-minute suggestion window" });
    }
    const siblings = schedule.sharedKey
      ? await prisma.scheduleEntry.findMany({
          where: { sharedKey: schedule.sharedKey }, orderBy: { id: "asc" },
        })
      : [schedule];
    if (siblings.some((s) => s.teacherId !== req.user!.userId ||
        s.discipline !== schedule.discipline || s.classroom !== schedule.classroom ||
        s.startsAt.getTime() !== schedule.startsAt.getTime() ||
        s.endsAt.getTime() !== schedule.endsAt.getTime())) {
      return res.status(409).json({ message: "Shared schedule entries are inconsistent" });
    }
    if (siblings.length > 4) {
      return res.status(409).json({ message: "One lesson supports at most four groups" });
    }
    const canonicalId = siblings[0].id;
    const existing = await prisma.lesson.findUnique({
      where: { sourceScheduleEntryId: canonicalId },
      select: { id: true },
    });
    if (existing) return res.json({ lessonId: existing.id, created: false });

    const discipline = await prisma.discipline.findFirst({
      where: { name: { equals: schedule.discipline, mode: "insensitive" } },
    });
    if (!discipline) return res.status(409).json({ message: "Schedule discipline missing from reference data" });

    const classrooms = await prisma.classroom.findMany({
      where: { name: schedule.classroom },
      select: { id: true, building: { select: { name: true } } },
    });
    const selectedClassroomId = req.body?.classroomId;
    const classroomId = selectedClassroomId === undefined
      ? (classrooms.length === 1 ? classrooms[0].id : null)
      : selectedClassroomId;
    if (typeof classroomId !== "number" || !Number.isSafeInteger(classroomId) ||
        !classrooms.some((room) => room.id === classroomId)) {
      return res.status(409).json({
        message: "Choose the matching classroomId (room name may repeat across buildings)",
        classrooms,
      });
    }

    const groupIds = [...new Set(siblings.map((s) => s.groupId))];
    const collision = await prisma.lesson.findFirst({
      where: {
        startsAt: { lt: schedule.endsAt },
        endsAt: { gt: schedule.startsAt },
        OR: [
          { classroomId },
          { teacherId: req.user.userId },
          { groupId: { in: groupIds } },
          { lessonGroups: { some: { groupId: { in: groupIds } } } },
        ],
      },
      select: { id: true, sourceScheduleEntryId: true },
    });
    if (collision) return res.status(409).json({
      message: "An overlapping lesson already exists; open it instead",
      lessonId: collision.id,
    });
    const lesson = await prisma.lesson.upsert({
      where: { sourceScheduleEntryId: canonicalId },
      update: {},
      create: {
        sourceScheduleEntryId: canonicalId,
        teacherId: req.user.userId,
        groupId: groupIds[0],
        classroomId,
        discipline: discipline.name,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        ...(groupIds.length > 1
          ? { lessonGroups: { create: groupIds.slice(1).map((groupId) => ({ groupId })) } }
          : {}),
      },
      select: { id: true },
    });
    return res.status(201).json({ lessonId: lesson.id, created: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to start scheduled lesson" });
  }
});

// Student may manually choose an eligible, already running lesson. This does not
// change the student's permanent group or the imported schedule.
router.get("/available-lessons", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "STUDENT") {
    return res.status(403).json({ message: "Only students may list available lessons" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId }, select: { groupId: true },
    });
    if (!user) return res.status(404).json({ message: "Student not found" });
    if (!user.groupId) return res.json({ lessons: [] });
    const now = new Date();
    const lessons = await prisma.lesson.findMany({
      where: {
        startsAt: { lte: now }, endsAt: { gt: now }, finishedAt: null,
        OR: [
          { groupId: user.groupId },
          { lessonGroups: { some: { groupId: user.groupId } } },
          { guests: { some: { studentId: req.user.userId } } },
        ],
      },
      select: {
        id: true, discipline: true, startsAt: true, endsAt: true,
        classroom: { select: { id: true, name: true, building: { select: { name: true } } } },
        group: { select: { id: true, name: true } },
        lessonGroups: { select: { group: { select: { id: true, name: true } } } },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    return res.json({
      lessons: lessons.map(({ lessonGroups, group, ...lesson }) => ({
        ...lesson,
        groups: [group, ...lessonGroups.map((entry) => entry.group)],
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to get available lessons" });
  }
});

export default router;
