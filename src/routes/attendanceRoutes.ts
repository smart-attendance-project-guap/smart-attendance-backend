import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import {
  markAttendance,
  getAttendanceHistory,
  getAttendanceStats,
  getLessonAttendance,
  getSuspiciousAttendance,
  approveAttendance,
  rejectAttendance,
  updateAttendanceChecks,
  getTeacherAttendanceStats,
  getTeacherLessonStats,
  getTeacherGroupStats,
} from "../controllers/attendanceController.js";

const router = Router();

router.post("/:id/mark", authMiddleware, markAttendance);
router.get("/history", authMiddleware, getAttendanceHistory);
router.get("/stats", authMiddleware, getAttendanceStats);
router.get("/teacher/stats", authMiddleware, getTeacherAttendanceStats);
router.get("/teacher/lessons/stats", authMiddleware, getTeacherLessonStats);
router.get("/teacher/groups/stats", authMiddleware, getTeacherGroupStats);
router.get("/lesson/:id", authMiddleware, getLessonAttendance);
router.get("/suspicious", authMiddleware, getSuspiciousAttendance);
router.patch("/:id/approve", authMiddleware, approveAttendance);
router.patch("/:id/reject", authMiddleware, rejectAttendance);
router.patch("/:id/checks", authMiddleware, updateAttendanceChecks);

export default router;