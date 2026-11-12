
import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

export function botAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const secret = process.env.BOT_SERVICE_TOKEN;

  if (!secret || secret.length < 32) {
    return res.status(503).json({
      message: "Bot authentication is not configured",
    });
  }

  const header = req.headers.authorization;

  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  const expected = Buffer.from(secret, "utf8");
  const received = Buffer.from(token, "utf8");

  if (
    !token ||
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return res.status(401).json({
      code: "UNAUTHORIZED_BOT",
      message: "Invalid bot service token",
    });
  }

  next();
}
