
import type { Request, Response } from "express";
import { claimTelegramNotifications } from "../services/telegramNotificationClaims.js";
import { saveTelegramNotificationResult } from "../services/telegramNotificationResults.js";

export async function claimNotifications(
  req: Request,
  res: Response,
) {
  try {
    const { limit } = req.body ?? {};

    if (
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 10
    ) {
      return res.status(400).json({
        code: "INVALID_REQUEST",
        message: "limit must be an integer from 1 to 10",
      });
    }

    const notifications = await claimTelegramNotifications(limit);

    return res.status(200).json({
      notifications,
    });
  } catch (error) {
    console.error("Failed to claim Telegram notifications:", error);

    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to claim notifications",
    });
  }
}

export async function reportNotificationResult(
  req: Request,
  res: Response,
) {
  try {
    const notificationId = Number(req.params.id);
    const body = req.body;

    if (
      !Number.isSafeInteger(notificationId) ||
      notificationId <= 0 ||
      !body ||
      typeof body.leaseToken !== "string" ||
      !body.leaseToken.trim()
    ) {
      return res.status(400).json({
        code: "INVALID_REQUEST",
        message: "Invalid notification ID or lease token",
      });
    }

    let result;

    if (body.status === "SENT") {
      if (
        !Number.isSafeInteger(body.telegramMessageId) ||
        body.telegramMessageId <= 0
      ) {
        return res.status(400).json({
          code: "INVALID_REQUEST",
          message: "Invalid Telegram message ID",
        });
      }

      result = {
        leaseToken: body.leaseToken,
        status: "SENT" as const,
        telegramMessageId: body.telegramMessageId,
      };
    } else if (body.status === "FAILED") {
      if (
        typeof body.errorCode !== "string" ||
        !body.errorCode.trim() ||
        body.errorCode.length > 100 ||
        typeof body.retryable !== "boolean"
      ) {
        return res.status(400).json({
          code: "INVALID_REQUEST",
          message: "Invalid delivery failure data",
        });
      }

      result = {
        leaseToken: body.leaseToken,
        status: "FAILED" as const,
        errorCode: body.errorCode,
        retryable: body.retryable,
      };
    } else {
      return res.status(400).json({
        code: "INVALID_REQUEST",
        message: "Status must be SENT or FAILED",
      });
    }

    const saved = await saveTelegramNotificationResult(
      notificationId,
      result,
    );

    if (!saved) {
      return res.status(409).json({
        code: "INVALID_LEASE",
        message: "Notification lease is invalid or expired",
      });
    }

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    console.error("Failed to save notification result:", error);

    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to save notification result",
    });
  }
}
