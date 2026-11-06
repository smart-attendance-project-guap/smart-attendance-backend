
import { randomBytes } from "node:crypto";
import { redisClient } from "../redis.js";

export const TELEGRAM_LINK_TTL_SECONDS = 300;

export async function createTelegramLinkCode(
  userId: number,
): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  const userKey = `telegram:link:user:${userId}`;

  const previousCode = await redisClient.get(userKey);

  const transaction = redisClient.multi();

  if (previousCode) {
    transaction.del(`telegram:link:code:${previousCode}`);
  }

  transaction.set(
    `telegram:link:code:${code}`,
    JSON.stringify({ userId, status: "WAITING_BOT" }),
    { EX: TELEGRAM_LINK_TTL_SECONDS },
  );

  transaction.set(userKey, code, {
    EX: TELEGRAM_LINK_TTL_SECONDS,
  });

  await transaction.exec();

  return code;
}
