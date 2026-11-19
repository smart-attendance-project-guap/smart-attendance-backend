import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";
import {
  attendanceChallengeTtlMs,
  consumeAttendanceChallenge,
  storeAttendanceChallenge,
} from "../utils/webauthnChallenge.js";
import { readWebAuthnConfig } from "../utils/webauthnConfig.js";
const ATTENDANCE_VERIFICATION_WINDOW_MS = 180_000;

function sendExpired(res: Response) {
  return res.status(410).json({
    code: "CHALLENGE_EXPIRED_OR_USED",
    message: "The attendance verification window has expired",
  });
}

async function getPendingAttendance(req: AuthRequest, res: Response) {
  if (req.user?.role !== "STUDENT") {
    res.status(403).json({
      code: "ACCESS_DENIED",
      message: "Only students can verify an attendance credential",
    });
    return;
  }

  const attendanceId = Number(req.params.id);
  if (!Number.isSafeInteger(attendanceId) || attendanceId <= 0) {
    res.status(400).json({
      code: "INVALID_REQUEST",
      message: "Invalid attendance ID",
    });
    return;
  }

  const attendance = await prisma.attendance.findFirst({
    where: { id: attendanceId, studentId: req.user.userId },
    select: {
      id: true,
      studentId: true,
      status: true,
      reviewed: true,
      markedAt: true,
    },
  });

  if (!attendance) {
    res.status(403).json({
      code: "ACCESS_DENIED",
      message: "Attendance record is unavailable to this student",
    });
    return;
  }

  if (attendance.status !== "PENDING" || attendance.reviewed) {
    res.status(409).json({
      code: "ATTENDANCE_NOT_PENDING",
      message: "Attendance is closed for verification",
    });
    return;
  }

    const deadlineMs = attendance.markedAt.getTime() + ATTENDANCE_VERIFICATION_WINDOW_MS;
  if (deadlineMs <= Date.now()) {
    sendExpired(res);
    return;
  }

  return { id: attendance.id, studentId: attendance.studentId, deadlineMs };
}

export async function getAttendanceDeviceOptions(req: AuthRequest, res: Response) {
  try {
    const attendance = await getPendingAttendance(req, res);
    if (!attendance) return;

    const { rpID } = readWebAuthnConfig();
    const credentials = await prisma.webAuthnCredential.findMany({
      where: { userId: attendance.studentId },
      select: { credentialId: true },
    });

    if (credentials.length === 0) {
      return res.status(409).json({
        code: "NO_REGISTERED_CREDENTIAL",
        message: "Register a WebAuthn credential first",
      });
    }

    const timeout = attendanceChallengeTtlMs(attendance.deadlineMs);
    if (!timeout) return sendExpired(res);

    const options = await generateAuthenticationOptions({
      rpID,
      timeout,
      userVerification: "required",
      allowCredentials: credentials.map(({ credentialId }) => ({
        id: credentialId,
      })),
    });

    const requestId = await storeAttendanceChallenge(
      attendance.studentId,
      attendance.id,
      options.challenge,
      attendance.deadlineMs,
    );

    if (!requestId) return sendExpired(res);

    return res.status(200).json({ requestId, options });
  } catch {
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to generate attendance verification options",
    });
  }
}

type VerifiedDeviceUpdate = {
  attendanceId: number;
  studentId: number;
  credentialRecordId: number;
  previousCounter: bigint;
  newCounter: number;
  backedUp: boolean;
};

async function saveVerifiedAttendanceDevice(update: VerifiedDeviceUpdate) {
  const credentialChanged = new Error("Credential changed during verification");

  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();

      const attendance = await tx.attendance.updateMany({
        where: {
          id: update.attendanceId,
          studentId: update.studentId,
          status: "PENDING",
          reviewed: false,
          markedAt: {
            gt: new Date(now.getTime() - ATTENDANCE_VERIFICATION_WINDOW_MS),
          },
        },
        data: { deviceChecked: true },
      });

      if (attendance.count !== 1) {
        return "ATTENDANCE_CLOSED";
      }

      const credential = await tx.webAuthnCredential.updateMany({
        where: {
          id: update.credentialRecordId,
          userId: update.studentId,
          counter: update.previousCounter,
        },
        data: {
          counter: BigInt(update.newCounter),
          backedUp: update.backedUp,
          lastUsedAt: now,
        },
      });

      if (credential.count !== 1) {
        throw credentialChanged;
      }

      return "SAVED";
    });
  } catch (error) {
    if (error === credentialChanged) {
      return "CREDENTIAL_CHANGED";
    }
    throw error;
  }
}

export async function verifyAttendanceDevice(req: AuthRequest, res: Response) {
  try {
    const attendance = await getPendingAttendance(req, res);
    if (!attendance) return;

    const { requestId, credential } = (req.body ?? {}) as {
      requestId?: unknown;
      credential?: unknown;
    };

    const requestIdPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    if (
      typeof requestId !== "string" ||
      !requestIdPattern.test(requestId) ||
      typeof credential !== "object" ||
      credential === null ||
      !("id" in credential) ||
      typeof credential.id !== "string" ||
      !credential.id
    ) {
      return res.status(400).json({
        code: "INVALID_REQUEST",
        message: "A valid requestId and authentication response are required",
      });
    }

    const { origin, rpID } = readWebAuthnConfig();
    const challenge = await consumeAttendanceChallenge(
      attendance.studentId,
      attendance.id,
      requestId,
    );

    if (!challenge) return sendExpired(res);

    const savedKey = await prisma.webAuthnCredential.findFirst({
      where: { credentialId: credential.id, userId: attendance.studentId },
    });

    if (!savedKey) {
      return res.status(403).json({
        code: "ACCESS_DENIED",
        message: "Credential is unavailable to this student",
      });
    }

    const verification = await verifyAuthenticationResponse({
      response: credential as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: savedKey.credentialId,
        publicKey: new Uint8Array(savedKey.publicKey),
        counter: Number(savedKey.counter),
      },
    }).catch(() => null);

    if (!verification?.verified) {
      return res.status(400).json({
        code: "VERIFICATION_FAILED",
        message: "WebAuthn authentication could not be verified",
      });
    }

    const result = await saveVerifiedAttendanceDevice({
      attendanceId: attendance.id,
      studentId: attendance.studentId,
      credentialRecordId: savedKey.id,
      previousCounter: savedKey.counter,
      newCounter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
    });

    if (result === "ATTENDANCE_CLOSED") {
      if (attendance.deadlineMs <= Date.now()) return sendExpired(res);

      return res.status(409).json({
        code: "ATTENDANCE_NOT_PENDING",
        message: "Attendance is closed for verification",
      });
    }

    if (result === "CREDENTIAL_CHANGED") {
      return res.status(400).json({
        code: "VERIFICATION_FAILED",
        message: "Request new options and try again",
      });
    }

    return res.status(200).json({ verified: true, status: "PENDING" });
  } catch {
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to verify attendance credential",
    });
  }
}