import { redisClient } from "../redis.js";
import {
  getPendingTelegramClaim,
  consumePendingTelegramClaim,
} from "../utils/telegramLink.js";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";
import {
  createTelegramLinkCode,
  claimTelegramLinkCode,
  TELEGRAM_LINK_TTL_SECONDS,
} from "../utils/telegramLink.js";

export async function startTelegramLink(
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
        message: "Only students can link Telegram",
      });
    }

    const student = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    if (student.telegramId) {
      return res.status(409).json({
        message: "Telegram is already linked",
      });
    }

    const botUsername = process.env.BOT_USERNAME
      ?.trim()
      .replace(/^@/, "");

    if (
      !botUsername ||
      !/^[A-Za-z0-9_]{5,32}$/.test(botUsername)
    ) {
      return res.status(503).json({
        message: "Telegram bot is not configured",
      });
    }

    const code = await createTelegramLinkCode(student.id);

    return res.status(200).json({
      status: "WAITING_BOT",
      linkUrl: `https://t.me/${botUsername}?start=${code}`,
      expiresAt: new Date(
        Date.now() + TELEGRAM_LINK_TTL_SECONDS * 1000,
      ).toISOString(),
    });
  } catch (error) {
    console.error("Telegram link error:", error);

    return res.status(500).json({
      message: "Failed to create Telegram link",
    });
  }
}


export async function claimTelegramLink(
  req: AuthRequest,
  res: Response,
) {
  try {
    const {
      code,
      telegramUserId,
      username,
      firstName,
    } = req.body ?? {};

    if (
      typeof code !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(code) ||
      typeof telegramUserId !== "string" ||
      !/^[1-9]\d*$/.test(telegramUserId) ||
      !Number.isSafeInteger(Number(telegramUserId)) ||
      (username !== undefined &&
        (typeof username !== "string" ||
          username.length > 32)) ||
      (firstName !== undefined &&
        (typeof firstName !== "string" ||
          firstName.length > 128))
    ) {
      return res.status(400).json({
        code: "INVALID_REQUEST",
        message: "Invalid Telegram linking data",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        telegramId: telegramUserId,
      },
    });

    if (existingUser) {
      return res.status(409).json({
        code: "TELEGRAM_ALREADY_LINKED",
        message: "Telegram account is already linked",
      });
    }

    const result = await claimTelegramLinkCode(
      code,
      telegramUserId,
      username,
      firstName,
    );

    if (result.status === "LINK_CODE_INVALID") {
      return res.status(404).json({
        code: "LINK_CODE_INVALID",
        message: "Link code is invalid or expired",
      });
    }

    if (result.status === "LINK_CODE_USED") {
      return res.status(409).json({
        code: "LINK_CODE_USED",
        message: "Link code has already been used",
      });
    }

    return res.status(200).json({
      status: "AWAITING_CONFIRMATION",
      message: "Confirm Telegram linking in Smart Attendance",
    });
  } catch (error) {
    console.error("Telegram claim error:", error);

    return res.status(500).json({
      message: "Failed to claim Telegram link",
    });
  }
}


export async function confirmTelegramLink(
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
        message: "Only students can link Telegram",
      });
    }

    const student = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    if (student.telegramId) {
      return res.status(409).json({
        message: "Telegram is already linked",
      });
    }

    const claim = await getPendingTelegramClaim(student.id);

    if (!claim) {
      return res.status(409).json({
        code: "LINK_NOT_READY",
        message: "No pending Telegram link to confirm",
      });
    }

    const consumed = await consumePendingTelegramClaim(
      student.id,
      claim.code,
      claim.telegramUserId,
    );

    if (!consumed) {
      return res.status(409).json({
        code: "LINK_NOT_READY",
        message: "Telegram link has expired or changed",
      });
    }


    try {
      const result = await prisma.user.updateMany({
        where: {
          id: student.id,
          role: "STUDENT",
          telegramId: null,
        },
        data: {
          telegramId: claim.telegramUserId,
        },
      });

      if (result.count !== 1) {
        return res.status(409).json({
          message: "Telegram is already linked",
        });
      }
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return res.status(409).json({
          code: "TELEGRAM_ALREADY_LINKED",
          message: "Telegram account is already linked",
        });
      }

      throw error;
    }


    return res.status(200).json({
      status: "LINKED",
      telegram: {
        id: claim.telegramUserId,
        username: claim.username ?? null,
      },
    });
  } catch (error) {
    console.error("Telegram confirmation error:", error);

    return res.status(500).json({
      message: "Failed to confirm Telegram link",
    });
  }
}


export async function getTelegramLinkStatus(
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
        message: "Only students can view Telegram linking",
      });
    }

    const student = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!student) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    if (student.telegramId) {
      return res.status(200).json({
        status: "LINKED",
        telegram: {
          id: student.telegramId,
        },
      });
    }

    const claim = await getPendingTelegramClaim(student.id);

    if (claim) {
      const ttl = await redisClient.ttl(
        `telegram:link:code:${claim.code}`,
      );

      if (ttl > 0) {
        return res.status(200).json({
          status: "AWAITING_CONFIRMATION",
          telegram: {
            id: claim.telegramUserId,
            username: claim.username ?? null,
            firstName: claim.firstName ?? null,
          },
          expiresAt: new Date(
            Date.now() + ttl * 1000,
          ).toISOString(),
        });
      }
    }

    const code = await redisClient.get(
      `telegram:link:user:${student.id}`,
    );

    if (code) {
      const ttl = await redisClient.ttl(
        `telegram:link:code:${code}`,
      );

      if (ttl > 0) {
        return res.status(200).json({
          status: "WAITING_BOT",
          expiresAt: new Date(
            Date.now() + ttl * 1000,
          ).toISOString(),
        });
      }
    }

    return res.status(200).json({
      status: "NOT_STARTED",
    });
  } catch (error) {
    console.error("Telegram link status error:", error);

    return res.status(500).json({
      message: "Failed to get Telegram link status",
    });
  }
}
