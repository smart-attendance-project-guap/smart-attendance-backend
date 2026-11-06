import { Router } from "express";
import { botAuthMiddleware } from "../middleware/botAuthMiddleware.js";
import { claimTelegramLink } from "../controllers/telegramController.js";

const router = Router();

router.use(botAuthMiddleware);

router.post("/link/claim", claimTelegramLink);

export default router;