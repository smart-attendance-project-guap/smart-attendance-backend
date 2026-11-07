
import { Router } from "express";
import { botAuthMiddleware } from "../middleware/botAuthMiddleware.js";
import { claimTelegramLink } from "../controllers/telegramController.js";
import {
  claimNotifications,
  reportNotificationResult,
} from "../controllers/internalTelegramNotificationsController.js";

const router = Router();

router.use(botAuthMiddleware);

router.post("/link/claim", claimTelegramLink);

router.post("/notifications/claim", claimNotifications);

router.post(
  "/notifications/:id/result",
  reportNotificationResult,
);

export default router;
