
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";
import {
  createTelegramLinkCode,
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
