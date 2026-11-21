import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";

const JWT_SECRET = process.env.JWT_SECRET!;

let wss: WebSocketServer | null = null;

interface AuthenticatedSocket extends WebSocket {
  user?: {
    userId: number;
    role: string;
  };
}

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({
    server,
    path: "/ws",
  });

  wss.on("connection", (socket, request) => {
    const authenticatedSocket = socket as AuthenticatedSocket;

    const url = new URL(
      request.url ?? "",
      `http://${request.headers.host ?? "localhost"}`,
    );

    const token = url.searchParams.get("token");

    if (!token) {
      socket.close(1008, "Authorization token is required");
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        userId: number;
        role: string;
      };

      authenticatedSocket.user = decoded;

      console.log(
        `WebSocket client connected: userId=${decoded.userId}, role=${decoded.role}`,
      );

      socket.send(
        JSON.stringify({
          type: "connected",
          message: "WebSocket connected",
        }),
      );
    } catch {
      socket.close(1008, "Invalid or expired token");
      return;
    }

    socket.on("close", () => {
      console.log("WebSocket client disconnected");
    });
  });
}

export async function broadcast(data: unknown) {
  if (!wss) {
    return;
  }

  if (
    typeof data !== "object" ||
    data === null ||
    !("lessonId" in data) ||
    typeof data.lessonId !== "number"
  ) {
    return;
  }

  const lesson = await prisma.lesson.findUnique({
    where: {
      id: data.lessonId,
    },
    select: {
      teacherId: true,
    },
  });

  if (!lesson) {
    return;
  }


  const message = JSON.stringify(data);

  // Определяем студента, которому принадлежит отметка
  const studentId =
    "studentId" in data && typeof data.studentId === "number"
      ? data.studentId
      : null;

  wss.clients.forEach((client) => {
    const authenticatedClient = client as AuthenticatedSocket;
    const user = authenticatedClient.user;

    if (client.readyState !== WebSocket.OPEN || !user) {
      return;
    }

    // Преподаватель получает события своих занятий
    const isLessonTeacher =
      user.role === "TEACHER" &&
      user.userId === lesson.teacherId;

    // Студент получает события только своей отметки
    const isAttendanceStudent =
      user.role === "STUDENT" &&
      studentId !== null &&
      user.userId === studentId;

    if (isLessonTeacher || isAttendanceStudent) {
      client.send(message);
    }
  });
}