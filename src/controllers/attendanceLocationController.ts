import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";
import {
  getDistanceMeters,
  parseLocationInput,
} from "../utils/attendanceLocation.js";

const LOCATION_WINDOW_MS = 180_000;
const LOCATION_RADIUS_METERS = 100;
const MAX_ACCURACY_METERS = 50;
const LOW_ACCURACY = "LOCATION_ACCURACY_TOO_LOW";
const OUTSIDE_RADIUS = "LOCATION_OUTSIDE_RADIUS";

export async function checkAttendanceLocation(req: AuthRequest, res: Response) {
  if (req.user?.role !== "STUDENT") {
    return res.status(403).json({
      code: "ACCESS_DENIED",
      message: "Only students can verify attendance location",
    });
  }

  const attendanceId = Number(req.params.id);
  const location = parseLocationInput(req.body);

  if (!Number.isSafeInteger(attendanceId) || attendanceId <= 0 || !location) {
    return res.status(400).json({
      code: "INVALID_REQUEST",
      message: "A valid attendance ID and location are required",
    });
  }

  try {
    const attendance = await prisma.attendance.findFirst({
      where: { id: attendanceId, studentId: req.user.userId },
      select: {
        status: true,
        reviewed: true,
        markedAt: true,
        rejectionReason: true,
        lesson: {
          select: {
            classroom: { select: { latitude: true, longitude: true } },
          },
        },
      },
    });

    if (!attendance) {
      return res.status(403).json({
        code: "ACCESS_DENIED",
        message: "Attendance record is unavailable to this student",
      });
    }

    if (attendance.status !== "PENDING" || attendance.reviewed) {
      return res.status(409).json({
        code: "ATTENDANCE_NOT_PENDING",
        message: "Attendance is closed for verification",
      });
    }

    const markedAtMs = attendance.markedAt.getTime();
    const now = Date.now();

    if (now - markedAtMs >= LOCATION_WINDOW_MS) {
      return res.status(410).json({
        code: "LOCATION_WINDOW_EXPIRED",
        message: "The location verification window has expired",
      });
    }

    let reason: string | null = null;
    if (location.accuracyMeters > MAX_ACCURACY_METERS) {
      reason = LOW_ACCURACY;
    } else if (getDistanceMeters(location, attendance.lesson.classroom) > LOCATION_RADIUS_METERS) {
      reason = OUTSIDE_RADIUS;
    }

    const previousReason = attendance.rejectionReason;
    const canReplaceReason =
      previousReason === null ||
      previousReason === LOW_ACCURACY ||
      previousReason === OUTSIDE_RADIUS;

    const result = await prisma.attendance.updateMany({
      where: {
        id: attendanceId,
        studentId: req.user.userId,
        status: "PENDING",
        reviewed: false,
        markedAt: { gt: new Date(Date.now() - LOCATION_WINDOW_MS) },
        rejectionReason: previousReason,
      },
      data: {
        locationChecked: reason === null,
        rejectionReason: canReplaceReason ? reason : previousReason,
      },
    });

    if (result.count !== 1) {
      return res.status(409).json({
        code: "ATTENDANCE_CHANGED",
        message: "Attendance changed during verification. Refresh and try again.",
      });
    }

    return res.status(200).json({
      status: "PENDING",
      locationChecked: reason === null,
      reason,
      captureTimeOutsideWindow:
        location.capturedAtMs < markedAtMs || location.capturedAtMs > now,
    });
  } catch {
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to verify attendance location",
    });
  }
}