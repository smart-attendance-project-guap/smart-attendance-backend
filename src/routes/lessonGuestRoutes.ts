import { Router } from "express";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";

const router = Router();

async function ownedLesson(req: AuthRequest, res: Response) {
  if (req.user?.role !== "TEACHER") {
    res.status(403).json({ message: "Only the lesson teacher may manage guests" });
    return null;
  }
  const raw = req.params.id;
  const id = typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id)) {
    res.status(400).json({ message: "Invalid lesson ID" });
    return null;
  }
  const lesson = await prisma.lesson.findUnique({
    where: { id },
    select: {
      id: true, teacherId: true, endsAt: true, finishedAt: true, groupId: true,
      lessonGroups: { select: { groupId: true } },
    },
  });
  if (!lesson || lesson.teacherId !== req.user.userId) {
    res.status(404).json({ message: "Lesson not found among your lessons" });
    return null;
  }
  return lesson;
}

// A guest gets permission only for this particular lesson; their permanent group is unchanged.
router.post("/:id/guests", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const lesson = await ownedLesson(req, res);
    if (!lesson) return;
    if (lesson.finishedAt || lesson.endsAt.getTime() <= Date.now()) {
      return res.status(409).json({ message: "Lesson has ended" });
    }
    const email = req.body?.studentEmail;
    if (typeof email !== "string" || email.length > 254 || !email.includes("@")) {
      return res.status(400).json({ message: "studentEmail is required" });
    }
    const student = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, role: true, groupId: true },
    });
    if (!student || student.role !== "STUDENT") {
      return res.status(404).json({ message: "Student not found" });
    }
    const participantIds = [lesson.groupId, ...lesson.lessonGroups.map((g) => g.groupId)];
    if (student.groupId && participantIds.includes(student.groupId)) {
      return res.status(400).json({ message: "Student is already eligible via their group" });
    }
    await prisma.lessonGuest.upsert({
      where: { lessonId_studentId: { lessonId: lesson.id, studentId: student.id } },
      create: { lessonId: lesson.id, studentId: student.id },
      update: {},
    });
    return res.json({ lessonId: lesson.id, studentId: student.id, allowed: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to authorize guest" });
  }
});

router.get("/:id/guests", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const lesson = await ownedLesson(req, res);
    if (!lesson) return;
    const guests = await prisma.lessonGuest.findMany({
      where: { lessonId: lesson.id },
      select: {
        student: {
          select: { id: true, firstName: true, lastName: true, email: true,
            group: { select: { id: true, name: true } } },
        },
      },
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ guests: guests.map((item) => item.student) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to list lesson guests" });
  }
});

export default router;
