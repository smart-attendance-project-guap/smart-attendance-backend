import "dotenv/config";
import { authMiddleware, type AuthRequest } from "./middleware/authMiddleware.js";
import express from "express";
import { createServer } from "node:http";
import { setupWebSocket } from "./websocket.js";
import { prisma } from "./prisma.js";
import authRoutes from "./routes/authRoutes.js";
import lessonRoutes from "./routes/lessonRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import { connectRedis } from "./redis.js";

const app = express();
const PORT = 3000;

const httpServer = createServer(app);
setupWebSocket(httpServer);

app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/lessons", lessonRoutes);
app.use("/api/attendance", attendanceRoutes);
app.get("/api/protected", authMiddleware, (req: AuthRequest, res) => {
  res.json({
    message: "Access granted",
    user: req.user,
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend is running",
  });
});

app.get("/api/db-test", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "ok",
      message: "Database connection is working",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "error",
      message: "Database connection failed",
    });
  }
});

connectRedis()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`Backend started on http://localhost:${PORT}`);
      console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
    });
  })
  .catch((error) => {
    console.error("Failed to connect to Redis:", error);
    process.exit(1);
  });