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