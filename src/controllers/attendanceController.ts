import type { Response } from "express";
import { prisma } from "../prisma.js";
import type { AuthRequest } from "../middleware/authMiddleware.js";

export async function markAttendance(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "STUDENT") {
      return res.status(403).json({
        message: "Only students can mark attendance",
      });
    }

    const lessonId = Number(req.params.id);
    const { qrToken } = req.body;

    if (!lessonId) {
      return res.status(400).json({
        message: "Invalid lesson id",
      });
    }

    if (!qrToken) {
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

    const student = await prisma.user.findUnique({
      where: {
        id: req.user.userId,
      },
    });

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    if (student.role !== "STUDENT") {
      return res.status(403).json({
        message: "Only students can mark attendance",
      });
    }

    if (student.groupId !== lesson.groupId) {
      return res.status(403).json({
        message: "Student does not belong to this lesson group",
      });
    }

    if (!lesson.qrToken || !lesson.qrExpiresAt) {
      return res.status(400).json({
        message: "QR code is not active",
      });
    }

    if (lesson.qrToken !== qrToken) {
      return res.status(400).json({
        message: "Invalid QR token",
      });
    }

    if (lesson.qrExpiresAt <= new Date()) {
      return res.status(400).json({
        message: "QR code has expired",
      });
    }

    const existingAttendance = await prisma.attendance.findFirst({
      where: {
        studentId: student.id,
        lessonId: lesson.id,
      },
    });

    if (existingAttendance) {
      return res.status(400).json({
        message: "Attendance already marked",
        attendance: existingAttendance,
      });
    }

    const status =
      new Date() > lesson.startsAt
        ? "LATE"
        : "PRESENT";

    const attendance = await prisma.attendance.create({
      data: {
        studentId: student.id,
        lessonId: lesson.id,
        status,
        faceChecked: false,
        deviceChecked: false,
        locationChecked: false,
      },
    });

    return res.status(201).json({
      message: "Attendance marked",
      attendance,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to mark attendance",
    });
  }
}

export async function getAttendanceHistory(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "STUDENT") {
      return res.status(403).json({
        message: "Only students can view attendance history",
      });
    }

    const attendances = await prisma.attendance.findMany({
      where: {
        studentId: req.user.userId,
      },
      include: {
        lesson: {
          include: {
            group: true,
            classroom: true,
          },
        },
      },
      orderBy: {
        markedAt: "desc",
      },
    });

    return res.json({
      attendances,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get attendance history",
    });
  }
}

export async function getAttendanceStats(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "STUDENT") {
      return res.status(403).json({
        message: "Only students can view attendance stats",
      });
    }

    const student = await prisma.user.findUnique({
      where: {
        id: req.user.userId,
      },
    });

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    if (!student.groupId) {
      return res.status(400).json({
        message: "Student is not assigned to a group",
      });
    }

    const lessons = await prisma.lesson.findMany({
      where: {
        groupId: student.groupId,
        finishedAt: {
          not: null,
        },
      },
      include: {
        attendances: {
          where: {
            studentId: student.id,
          },
        },
      },
    });

    const totalLessons = lessons.length;

    const attendedLessons = lessons.filter((lesson) => {
      const attendance = lesson.attendances[0];

      return (
        attendance &&
        (attendance.status === "PRESENT" ||
          attendance.status === "LATE")
      );
    }).length;

    const rejectedLessons = lessons.filter((lesson) => {
      const attendance = lesson.attendances[0];

      return attendance?.status === "REJECTED";
    }).length;

    const missedLessons = totalLessons - attendedLessons;

    const attendancePercentage =
      totalLessons > 0
        ? Number(((attendedLessons / totalLessons) * 100).toFixed(2))
        : 0;

    return res.json({
      totalLessons,
      attendedLessons,
      missedLessons,
      rejectedLessons,
      attendancePercentage,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get attendance stats",
    });
  }
}

export async function getLessonAttendance(
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
        message: "Only teachers can view lesson attendance",
      });
    }

    const lessonId = Number(req.params.id);

    if (!lessonId) {
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
        message: "You can only view attendance for your own lessons",
      });
    }

    const attendances = await prisma.attendance.findMany({
      where: {
        lessonId: lesson.id,
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: {
        markedAt: "asc",
      },
    });

    const students = await prisma.user.findMany({
      where: {
        role: "STUDENT",
        groupId: lesson.groupId,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });

    const presentStudentIds = new Set(
      attendances.map((attendance) => attendance.studentId),
    );

    const absentStudents = students.filter(
      (student) => !presentStudentIds.has(student.id),
    );

    return res.json({
      lessonId: lesson.id,
      attendances,
      absentStudents,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get lesson attendance",
    });
  }
}

export async function getSuspiciousAttendance(
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
        message: "Only teachers can view suspicious attendance",
      });
    }

    const suspiciousAttendances = await prisma.attendance.findMany({
      where: {
        lesson: {
          teacherId: req.user.userId,
        },
        OR: [
          {
            faceChecked: false,
          },
          {
            deviceChecked: false,
          },
          {
            locationChecked: false,
          },
        ],
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        lesson: {
          include: {
            group: true,
            classroom: true,
          },
        },
      },
      orderBy: {
        markedAt: "desc",
      },
    });

    return res.json({
      attendances: suspiciousAttendances,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get suspicious attendance",
    });
  }
}

export async function approveAttendance(
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
        message: "Only teachers can approve attendance",
      });
    }

    const attendanceId = Number(req.params.id);

    if (!attendanceId) {
      return res.status(400).json({
        message: "Invalid attendance id",
      });
    }

    const attendance = await prisma.attendance.findUnique({
      where: {
        id: attendanceId,
      },
      include: {
        lesson: true,
      },
    });

    if (!attendance) {
      return res.status(404).json({
        message: "Attendance not found",
      });
    }

    if (attendance.lesson.teacherId !== req.user.userId) {
      return res.status(403).json({
        message: "You can only approve attendance for your own lessons",
      });
    }

    if (attendance.reviewed) {
      return res.status(400).json({
        message: "Attendance has already been reviewed",
      });
    }

    const updatedAttendance = await prisma.attendance.update({
      where: {
        id: attendance.id,
      },
      data: {
        status: "PRESENT",
        reviewed: true,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
    });

    return res.json({
      message: "Attendance approved",
      attendance: updatedAttendance,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to approve attendance",
    });
  }
}

export async function rejectAttendance(
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
        message: "Only teachers can reject attendance",
      });
    }

    const attendanceId = Number(req.params.id);
    const { rejectionReason } = req.body;

    if (!attendanceId) {
      return res.status(400).json({
        message: "Invalid attendance id",
      });
    }

    if (!rejectionReason) {
      return res.status(400).json({
        message: "rejectionReason is required",
      });
    }

    const attendance = await prisma.attendance.findUnique({
      where: {
        id: attendanceId,
      },
      include: {
        lesson: true,
      },
    });

    if (!attendance) {
      return res.status(404).json({
        message: "Attendance not found",
      });
    }

    if (attendance.lesson.teacherId !== req.user.userId) {
      return res.status(403).json({
        message: "You can only reject attendance for your own lessons",
      });
    }

    if (attendance.reviewed) {
      return res.status(400).json({
        message: "Attendance has already been reviewed",
      });
    }

    const updatedAttendance = await prisma.attendance.update({
      where: {
        id: attendance.id,
      },
      data: {
        status: "REJECTED",
        reviewed: true,
        reviewedAt: new Date(),
        rejectionReason,
      },
    });

    return res.json({
      message: "Attendance rejected",
      attendance: updatedAttendance,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to reject attendance",
    });
  }
}

export async function getTeacherAttendanceStats(
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
        message: "Only teachers can view attendance stats",
      });
    }

    const lessons = await prisma.lesson.findMany({
      where: {
        teacherId: req.user.userId,
        finishedAt: {
          not: null,
        },
      },
      include: {
        attendances: true,
      },
    });

    const totalLessons = lessons.length;

    let totalStudents = 0;
    let attendedStudents = 0;

    for (const lesson of lessons) {
      const students = await prisma.user.count({
        where: {
          role: "STUDENT",
          groupId: lesson.groupId,
        },
      });

      totalStudents += students;

      attendedStudents += lesson.attendances.filter(
        (attendance) =>
          attendance.status === "PRESENT" ||
          attendance.status === "LATE",
      ).length;
    }

    const attendancePercentage =
      totalStudents > 0
        ? Number(((attendedStudents / totalStudents) * 100).toFixed(2))
        : 0;

    return res.json({
      totalLessons,
      totalStudents,
      attendedStudents,
      attendancePercentage,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get teacher attendance stats",
    });
  }
}

export async function getTeacherLessonStats(
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
        message: "Only teachers can view lesson stats",
      });
    }

    const lessons = await prisma.lesson.findMany({
      where: {
        teacherId: req.user.userId,
        finishedAt: {
          not: null,
        },
      },
      include: {
        group: true,
        classroom: true,
        attendances: true,
      },
      orderBy: {
        startsAt: "desc",
      },
    });

    const stats = await Promise.all(
      lessons.map(async (lesson) => {
        const totalStudents = await prisma.user.count({
          where: {
            role: "STUDENT",
            groupId: lesson.groupId,
          },
        });

        const attendedStudents = lesson.attendances.filter(
          (attendance) =>
            attendance.status === "PRESENT" ||
            attendance.status === "LATE",
        ).length;

        const attendancePercentage =
          totalStudents > 0
            ? Number(
                ((attendedStudents / totalStudents) * 100).toFixed(2),
              )
            : 0;

        return {
          lessonId: lesson.id,
          startsAt: lesson.startsAt,
          endsAt: lesson.endsAt,
          group: lesson.group,
          classroom: lesson.classroom,
          totalStudents,
          attendedStudents,
          attendancePercentage,
        };
      }),
    );

    return res.json({
      stats,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get lesson stats",
    });
  }
}

export async function getTeacherGroupStats(
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
        message: "Only teachers can view group stats",
      });
    }

    const lessons = await prisma.lesson.findMany({
      where: {
        teacherId: req.user.userId,
        finishedAt: {
          not: null,
        },
      },
      include: {
        group: true,
        attendances: true,
      },
    });

    const groupMap = new Map<
      number,
      {
        groupId: number;
        groupName: string;
        totalLessons: number;
        totalStudents: number;
        attendedStudents: number;
      }
    >();

    for (const lesson of lessons) {
      const existing = groupMap.get(lesson.groupId);

      const totalStudents = await prisma.user.count({
        where: {
          role: "STUDENT",
          groupId: lesson.groupId,
        },
      });

      const attendedStudents = lesson.attendances.filter(
        (attendance) =>
          attendance.status === "PRESENT" ||
          attendance.status === "LATE",
      ).length;

      if (existing) {
        existing.totalLessons += 1;
        existing.totalStudents += totalStudents;
        existing.attendedStudents += attendedStudents;
      } else {
        groupMap.set(lesson.groupId, {
          groupId: lesson.groupId,
          groupName: lesson.group.name,
          totalLessons: 1,
          totalStudents,
          attendedStudents,
        });
      }
    }

    const stats = Array.from(groupMap.values()).map((group) => ({
      ...group,
      attendancePercentage:
        group.totalStudents > 0
          ? Number(
              ((group.attendedStudents / group.totalStudents) * 100).toFixed(2),
            )
          : 0,
    }));

    return res.json({
      stats,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get group stats",
    });
  }
}

export async function updateAttendanceChecks(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "STUDENT") {
      return res.status(403).json({
        message: "Only students can update attendance checks",
      });
    }

    const attendanceId = Number(req.params.id);

    if (!attendanceId) {
      return res.status(400).json({
        message: "Invalid attendance id",
      });
    }

    const {
      faceChecked,
      deviceChecked,
      locationChecked,
      rejectionReason,
    } = req.body;

    if (
      typeof faceChecked !== "boolean" ||
      typeof deviceChecked !== "boolean" ||
      typeof locationChecked !== "boolean"
    ) {
      return res.status(400).json({
        message: "Check results must be boolean",
      });
    }

    const attendance = await prisma.attendance.findUnique({
      where: {
        id: attendanceId,
      },
    });

    if (!attendance) {
      return res.status(404).json({
        message: "Attendance not found",
      });
    }

    if (attendance.studentId !== req.user.userId) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    if (attendance.reviewed) {
      return res.status(400).json({
        message: "Attendance has already been reviewed",
      });
    }

    const allChecksPassed =
      faceChecked &&
      deviceChecked &&
      locationChecked;

    const updatedAttendance = await prisma.attendance.update({
      where: {
        id: attendanceId,
      },
      data: {
        faceChecked,
        deviceChecked,
        locationChecked,
        status: allChecksPassed ? "PRESENT" : "REJECTED",
        rejectionReason: allChecksPassed
          ? null
          : rejectionReason || "One or more checks failed",
      },
    });

    return res.json({
      message: "Attendance checks updated",
      attendance: updatedAttendance,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to update attendance checks",
    });
  }
}