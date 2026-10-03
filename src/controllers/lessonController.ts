import type { Response } from "express";
import { prisma } from "../prisma.js";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { nanoid } from "nanoid";
import { redisClient } from "../redis.js";

export async function createLesson(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "TEACHER") {
      return res.status(403).json({
        message: "Only teachers can create lessons",
      });
    }

    const { groupId, classroomId, startsAt, endsAt } = req.body;

    if (
      groupId === undefined ||
      classroomId === undefined ||
      startsAt === undefined ||
      endsAt === undefined
    ) {
      return res.status(400).json({
        message: "groupId, classroomId, startsAt and endsAt are required",
      });
    }

    const normalizedGroupId = Number(groupId);
    const normalizedClassroomId = Number(classroomId);

    if (
      !Number.isInteger(normalizedGroupId) ||
      normalizedGroupId <= 0
    ) {
      return res.status(400).json({
        message: "Invalid groupId",
      });
    }

    if (
      !Number.isInteger(normalizedClassroomId) ||
      normalizedClassroomId <= 0
    ) {
      return res.status(400).json({
        message: "Invalid classroomId",
      });
    }

    if (
      typeof startsAt !== "string" ||
      typeof endsAt !== "string" ||
      !startsAt.trim() ||
      !endsAt.trim()
    ) {
      return res.status(400).json({
        message: "startsAt and endsAt must be valid date strings",
      });
    }

    const group = await prisma.group.findUnique({
      where: {
        id: normalizedGroupId,
      },
    });

    if (!group) {
      return res.status(404).json({
        message: "Group not found",
      });
    }

    const classroom = await prisma.classroom.findUnique({
      where: {
        id: normalizedClassroomId,
      },
    });

    if (!classroom) {
      return res.status(404).json({
        message: "Classroom not found",
      });
    }

    const start = new Date(startsAt);
    const end = new Date(endsAt);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        message: "Invalid date format",
      });
    }

    if (end <= start) {
      return res.status(400).json({
        message: "endsAt must be later than startsAt",
      });
    }

    const lesson = await prisma.lesson.create({
      data: {
        teacherId: req.user.userId,
        groupId: normalizedGroupId,
        classroomId: normalizedClassroomId,
        startsAt: start,
        endsAt: end,
      },
    });

    return res.status(201).json({
      message: "Lesson created",
      lesson,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to create lesson",
    });
  }
}

export async function finishLesson(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "TEACHER") {
      return res.status(403).json({
        message: "Only teachers can finish lessons",
      });
    }

    const lessonId = Number(req.params.id);

    if (!Number.isInteger(lessonId) || lessonId <= 0) {
      return res.status(400).json({
        message: "Invalid lesson id",
      });
    }

    const lesson = await prisma.lesson.findUnique({
      where: {
        id: lessonId,
      },
    });

    if (!lesson) {
      return res.status(404).json({
        message: "Lesson not found",
      });
    }

    if (lesson.teacherId !== req.user.userId) {
      return res.status(403).json({
        message: "You can finish only your own lessons",
      });
    }

    if (lesson.finishedAt) {
      return res.status(400).json({
        message: "Lesson is already finished",
      });
    }

    const updatedLesson = await prisma.lesson.update({
      where: {
        id: lessonId,
      },
      data: {
        finishedAt: new Date(),
      },
    });

    return res.json({
      message: "Lesson finished",
      lesson: updatedLesson,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to finish lesson",
    });
  }
}

export async function generateLessonQr(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "TEACHER") {
      return res.status(403).json({
        message: "Only teachers can generate QR",
      });
    }

    const lessonId = Number(req.params.id);

    if (!Number.isInteger(lessonId) || lessonId <= 0) {
      return res.status(400).json({
        message: "Invalid lesson id",
      });
    }

    const lesson = await prisma.lesson.findUnique({
      where: {
        id: lessonId,
      },
    });

    if (!lesson) {
      return res.status(404).json({
        message: "Lesson not found",
      });
    }

    if (lesson.teacherId !== req.user.userId) {
      return res.status(403).json({
        message: "You can generate QR only for your own lessons",
      });
    }

    if (lesson.finishedAt) {
      return res.status(400).json({
        message: "Lesson is already finished",
      });
    }

    const qrToken = nanoid(32);
    const qrExpiresAt = new Date(Date.now() + 15 * 1000);

    await redisClient.set(
      `lesson:${lessonId}:qr`,
      qrToken,
      {
        EX: 15,
      },
    );

    const updatedLesson = await prisma.lesson.update({
      where: {
        id: lessonId,
      },
      data: {
        qrToken,
        qrExpiresAt,
      },
    });

    return res.json({
      message: "QR generated",
      qrToken: updatedLesson.qrToken,
      qrExpiresAt: updatedLesson.qrExpiresAt,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to generate QR",
    });
  }
}

export async function validateLessonQr(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const lessonId = Number(req.params.id);
    const { qrToken } = req.body;

    if (!Number.isInteger(lessonId) || lessonId <= 0) {
      return res.status(400).json({
        message: "Invalid lesson id",
      });
    }

    if (
      typeof qrToken !== "string" ||
      !qrToken.trim()
    ) {
      return res.status(400).json({
        message: "qrToken is required",
      });
    }

    const lesson = await prisma.lesson.findUnique({
      where: {
        id: lessonId,
      },
    });

    if (!lesson) {
      return res.status(404).json({
        message: "Lesson not found",
      });
    }

    if (lesson.finishedAt) {
      return res.status(400).json({
        message: "Lesson is already finished",
      });
    }

    const activeQrToken = await redisClient.get(
      `lesson:${lessonId}:qr`,
    );

    if (!activeQrToken) {
      return res.status(400).json({
        message: "QR code is not active",
      });
    }

    if (activeQrToken !== qrToken) {
      return res.status(400).json({
        message: "Invalid QR token",
      });
    }

    return res.json({
      valid: true,
      message: "QR code is valid",
      lessonId: lesson.id,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to validate QR",
    });
  }
}

export async function getTeacherLessons(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "TEACHER") {
      return res.status(403).json({
        message: "Only teachers can view their lessons",
      });
    }

    const lessons = await prisma.lesson.findMany({
      where: {
        teacherId: req.user.userId,
      },
      include: {
        group: true,
        classroom: true,
      },
      orderBy: {
        startsAt: "desc",
      },
    });

    return res.json({
      lessons,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get teacher lessons",
    });
  }
}