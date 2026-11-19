
import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Группы для регистрации студентов (без авторизации)
router.get("/registration/groups", async (_req, res) => {
  try {
    const groups = await prisma.group.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: "asc" },
    });

    return res.status(200).json({ groups });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to get registration groups",
    });
  }
});

// Получить все учебные группы
router.get("/groups", authMiddleware, async (_req, res) => {
  try {
    const groups = await prisma.group.findMany({
      orderBy: { name: "asc" },
    });

    return res.status(200).json({ groups });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to get groups",
    });
  }
});

// Получить все корпуса ГУАП
router.get("/buildings", authMiddleware, async (_req, res) => {
  try {
    const buildings = await prisma.building.findMany({
      select: {
        id: true,
        name: true,
        address: true,
      },
      orderBy: { name: "asc" },
    });

    return res.status(200).json({ buildings });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to get buildings",
    });
  }
});

// Получить аудитории (можно выбрать конкретный корпус)
router.get("/classrooms", authMiddleware, async (req, res) => {
  try {
    const { buildingId } = req.query;

    if (
      buildingId !== undefined &&
      (
        typeof buildingId !== "string" ||
        !/^[1-9]\d*$/.test(buildingId) ||
        !Number.isSafeInteger(Number(buildingId))
      )
    ) {
      return res.status(400).json({
        message: "Invalid buildingId",
      });
    }

    const classrooms = await prisma.classroom.findMany({

      ...(buildingId !== undefined
        ? { where: { buildingId: Number(buildingId) } }
        : {}),

      include: {
        building: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return res.status(200).json({ classrooms });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to get classrooms",
    });
  }
});

// Получить все дисциплины
router.get("/disciplines", authMiddleware, async (_req, res) => {
  try {
    const disciplines = await prisma.discipline.findMany({
      orderBy: { name: "asc" },
    });

    return res.status(200).json({ disciplines });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to get disciplines",
    });
  }
});

export default router;
