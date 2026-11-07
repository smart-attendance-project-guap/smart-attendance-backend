
import { prisma } from "../prisma.js";

export type NotificationDeliveryResult =
  | {
      leaseToken: string;
      status: "SENT";
      telegramMessageId: number;
    }
  | {
      leaseToken: string;
      status: "FAILED";
      errorCode: string;
      retryable: boolean;
    };

export async function saveTelegramNotificationResult(
  notificationId: number,
  result: NotificationDeliveryResult,
): Promise<boolean> {
  const notification = await prisma.telegramNotification.findUnique({
    where: { id: notificationId },
  });

  const now = new Date();

  if (
    !notification ||
    notification.status !== "PROCESSING" ||
    notification.leaseToken !== result.leaseToken ||
    !notification.leaseExpiresAt ||
    notification.leaseExpiresAt <= now
  ) {
    return false;
  }

  const where = {
    id: notificationId,
    status: "PROCESSING" as const,
    leaseToken: result.leaseToken,
    leaseExpiresAt: { gt: now },
  };

  if (result.status === "SENT") {
    const updated = await prisma.telegramNotification.updateMany({
      where,
      data: {
        status: "SENT",
        telegramMessageId: result.telegramMessageId,
        sentAt: now,
        lastErrorCode: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });

    return updated.count === 1;
  }

  const shouldRetry = result.retryable && notification.attempts < 5;

  const retryDelaySeconds = Math.min(
    60 * 2 ** Math.max(0, notification.attempts - 1),
    900,
  );

  const updated = await prisma.telegramNotification.updateMany({
    where,
    data: {
      status: shouldRetry ? "PENDING" : "FAILED",
      lastErrorCode: result.errorCode,
      leaseToken: null,
      leaseExpiresAt: null,
      ...(shouldRetry && {
        scheduledAt: new Date(
          now.getTime() + retryDelaySeconds * 1000,
        ),
      }),
    },
  });

  return updated.count === 1;
}
