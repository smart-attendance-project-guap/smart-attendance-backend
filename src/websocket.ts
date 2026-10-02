import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

let wss: WebSocketServer | null = null;

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({
    server,
    path: "/ws",
  });

  wss.on("connection", (socket) => {
    console.log("WebSocket client connected");

    socket.send(
      JSON.stringify({
        type: "connected",
        message: "WebSocket connected",
      }),
    );

    socket.on("close", () => {
      console.log("WebSocket client disconnected");
    });
  });
}

export function broadcast(data: unknown) {
  if (!wss) {
    return;
  }

  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
