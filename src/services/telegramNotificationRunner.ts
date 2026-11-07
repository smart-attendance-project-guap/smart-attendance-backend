
import {
  scheduleUpcomingTelegramReminders,
  scheduleMissedTelegramNotifications,
} from "./telegramNotificationScheduler.js";

const CHECK_INTERVAL_MS = 60_000;

export function startTelegramNotificationScheduler() {
  let isRunning = false;

  async function checkNotifications() {
    if (isRunning) {
      return;
    }

    isRunning = true;

    try {

      if (process.env.TELEGRAM_NOTIFICATION_SCHEDULER_DRY_RUN === "true") {
        console.log("Telegram scheduler: test run, no notifications created");
        return;
      }

      const reminders =
        await scheduleUpcomingTelegramReminders();

      const missed =
        await scheduleMissedTelegramNotifications();

      if (reminders > 0 || missed > 0) {
        console.log("Telegram notifications scheduled:", {
          reminders,
          missed,
        });
      }
    } catch (error) {
      console.error(
        "Telegram notification scheduler error:",
        error,
      );
    } finally {
      isRunning = false;
    }
  }

  void checkNotifications();

  return setInterval(
    () => {
      void checkNotifications();
    },
    CHECK_INTERVAL_MS,
  );
}
