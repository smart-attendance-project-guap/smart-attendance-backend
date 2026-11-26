import { Router } from "express";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";
import { isAttendanceExcluded } from "../utils/attendanceDisciplinePolicy.js";

const router = Router();
const ADVANCE_MINUTES = 15;

// Показывает только пары группы текущего студента с 15 минут до начала.
router.get("/current", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "STUDENT") {
    return res.status(403).json({ message: "Only students can view their schedule" });
  }

  try {
    const student = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { groupId: true },
    });
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }
    if (student.groupId === null) {
      return res.json({ lessons: [] });
    }

    const now = new Date();
    const visibleUntil = new Date(now.getTime() + ADVANCE_MINUTES * 60_000);

    const lessons = await prisma.scheduleEntry.findMany({
      where: {
        groupId: student.groupId,
        startsAt: { lte: visibleUntil },
        endsAt: { gt: now },
      },
      select: {
        id: true,
        discipline: true,
        classroom: true,
        teacherName: true,
        startsAt: true,
        endsAt: true,
      },
      orderBy: { startsAt: "asc" },
    });

    return res.json({ lessons: lessons.filter((lesson) => !isAttendanceExcluded(lesson.discipline)) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to load current lessons" });
  }
});

export default router;
