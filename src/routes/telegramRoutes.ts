
import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import {
  startTelegramLink,
  confirmTelegramLink,
  getTelegramLinkStatus,
} from "../controllers/telegramController.js";

const router = Router();

router.post("/link/start", authMiddleware, startTelegramLink);

router.get("/link/status", authMiddleware, getTelegramLinkStatus);

router.post("/link/confirm", authMiddleware, confirmTelegramLink);

export default router;
