import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import {
  createLesson,
  finishLesson,
  generateLessonQr,
  validateLessonQr,
  getTeacherLessons,
} from "../controllers/lessonController.js";
const router = Router();

router.get("/", authMiddleware, getTeacherLessons);
router.post("/", authMiddleware, createLesson);
router.patch("/:id/finish", authMiddleware, finishLesson);
router.post("/:id/qr", authMiddleware, generateLessonQr);
router.post("/:id/qr/validate", authMiddleware, validateLessonQr);

export default router;