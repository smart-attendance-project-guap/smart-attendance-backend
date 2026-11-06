
import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { startTelegramLink } from "../controllers/telegramController.js";

const router = Router();

router.post("/link/start", authMiddleware, startTelegramLink);

export default router;
