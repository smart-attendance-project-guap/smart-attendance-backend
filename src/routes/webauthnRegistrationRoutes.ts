import { Router } from "express";
import {
  getRegistrationOptions,
  verifyRegistration,
} from "../controllers/webauthnRegistrationController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/register/options", authMiddleware, getRegistrationOptions);
router.post("/register/verify", authMiddleware, verifyRegistration);

export default router;