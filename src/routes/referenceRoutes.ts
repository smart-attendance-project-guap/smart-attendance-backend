import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/registration/groups", async (_req, res) => {
  try {
    const groups = await prisma.group.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return res.status(200).json({
      groups,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get registration groups",
    });
  }
});


router.get("/groups", authMiddleware, async (req, res) => {
  try {
    const groups = await prisma.group.findMany({
      orderBy: {
        name: "asc",
      },
    });

    return res.status(200).json({
      groups,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get groups",
    });
  }
});

router.get("/classrooms", authMiddleware, async (req, res) => {
  try {
    const classrooms = await prisma.classroom.findMany({
      orderBy: {
        name: "asc",
      },
    });

    return res.status(200).json({
      classrooms,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to get classrooms",
    });
  }
});

export default router;