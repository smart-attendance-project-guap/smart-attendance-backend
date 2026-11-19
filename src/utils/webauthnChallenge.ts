import { randomUUID } from "node:crypto";
import { redisClient } from "../redis.js";

export const WEBAUTHN_REGISTRATION_TTL_SECONDS = 120;

function registrationKey(userId: number, requestId: string) {
  return `webauthn:registration:${userId}:${requestId}`;
}

export async function storeRegistrationChallenge(
  userId: number,
  challenge: string,
) {
  const requestId = randomUUID();

  await redisClient.set(registrationKey(userId, requestId), challenge, {
    EX: WEBAUTHN_REGISTRATION_TTL_SECONDS,
  });

  return requestId;
}

export async function consumeRegistrationChallenge(
  userId: number,
  requestId: string,
) {
  return redisClient.getDel(registrationKey(userId, requestId));
}
function attendanceKey(userId: number, attendanceId: number, requestId: string) {
  return `webauthn:attendance:${userId}:${attendanceId}:${requestId}`;
}

export function attendanceChallengeTtlMs(deadlineMs: number) {
  return Math.max(0, Math.min(120_000, deadlineMs - Date.now()));
}

export async function storeAttendanceChallenge(
  userId: number,
  attendanceId: number,
  challenge: string,
  deadlineMs: number,
) {
  const ttlMs = attendanceChallengeTtlMs(deadlineMs);

  if (ttlMs === 0) {
    return null;
  }

  const requestId = randomUUID();

  await redisClient.set(attendanceKey(userId, attendanceId, requestId), challenge, {
    PX: ttlMs,
  });

  return requestId;
}

export async function consumeAttendanceChallenge(
  userId: number,
  attendanceId: number,
  requestId: string,
) {
  return redisClient.getDel(attendanceKey(userId, attendanceId, requestId));
}