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


export type TelegramClaimResult =
  | {
      status: "AWAITING_CONFIRMATION";
      userId: number;
    }
  | {
      status: "LINK_CODE_INVALID" | "LINK_CODE_USED";
    };

export async function claimTelegramLinkCode(
  code: string,
  telegramUserId: string,
  username?: string,
  firstName?: string,
): Promise<TelegramClaimResult> {
  const result = await redisClient.eval(
    `
    local raw = redis.call("GET", KEYS[1])

    if not raw then
      return "LINK_CODE_INVALID"
    end

    local data = cjson.decode(raw)

    if data.status ~= "WAITING_BOT" then
      return "LINK_CODE_USED"
    end

    data.status = "AWAITING_CONFIRMATION"
    data.telegramUserId = ARGV[1]

    if ARGV[2] ~= "" then
      data.username = ARGV[2]
    end

    if ARGV[3] ~= "" then
      data.firstName = ARGV[3]
    end

    redis.call(
      "SET",
      KEYS[1],
      cjson.encode(data),
      "KEEPTTL"
    )

    return tostring(data.userId)
    `,
    {
      keys: [`telegram:link:code:${code}`],
      arguments: [
        telegramUserId,
        username ?? "",
        firstName ?? "",
      ],
    },
  );

  if (
    result === "LINK_CODE_INVALID" ||
    result === "LINK_CODE_USED"
  ) {
    return { status: result };
  }

  const userId = Number(result);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid Telegram link user ID");
  }

  return {
    status: "AWAITING_CONFIRMATION",
    userId,
  };
}


export type PendingTelegramClaim = {
  code: string;
  telegramUserId: string;
  username?: string | undefined;
  firstName?: string | undefined;
};


export async function getPendingTelegramClaim(
  userId: number,
): Promise<PendingTelegramClaim | null> {
  const code = await redisClient.get(
    `telegram:link:user:${userId}`,
  );

  if (!code) {
    return null;
  }

  const raw = await redisClient.get(
    `telegram:link:code:${code}`,
  );

  if (!raw) {
    return null;
  }

  const data = JSON.parse(raw) as {
    userId: number;
    status: string;
    telegramUserId?: string;
    username?: string;
    firstName?: string;
  };

  if (
    data.userId !== userId ||
    data.status !== "AWAITING_CONFIRMATION" ||
    !data.telegramUserId
  ) {
    return null;
  }

  return {
    code,
    telegramUserId: data.telegramUserId,
    username: data.username,
    firstName: data.firstName,
  };
}


export async function consumePendingTelegramClaim(
  userId: number,
  code: string,
  telegramUserId: string,
): Promise<boolean> {
  const result = await redisClient.eval(
    `
    local currentCode = redis.call("GET", KEYS[1])

    if currentCode ~= ARGV[1] then
      return 0
    end

    local raw = redis.call("GET", KEYS[2])

    if not raw then
      return 0
    end

    local data = cjson.decode(raw)

    if tonumber(data.userId) ~= tonumber(ARGV[2])
      or data.status ~= "AWAITING_CONFIRMATION"
      or tostring(data.telegramUserId) ~= ARGV[3]
    then
      return 0
    end

    redis.call("DEL", KEYS[1], KEYS[2])

    return 1
    `,
    {
      keys: [
        `telegram:link:user:${userId}`,
        `telegram:link:code:${code}`,
      ],
      arguments: [
        code,
        String(userId),
        telegramUserId,
      ],
    },
  );

  return result === 1;
}
