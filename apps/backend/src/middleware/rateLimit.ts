import type { NextFunction, Request, Response } from "express";

const WINDOW_MS = 60 * 1000;
const DEFAULT_LIMIT = Number(process.env.DEFAULT_RATE_LIMIT_PER_MINUTE || 120);

const bucket = new Map<string, { count: number; startedAt: number }>();

export const simpleRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.ip || "unknown";
  const now = Date.now();
  const item = bucket.get(key);

  if (!item || now - item.startedAt > WINDOW_MS) {
    bucket.set(key, { count: 1, startedAt: now });
    next();
    return;
  }

  if (item.count >= DEFAULT_LIMIT) {
    res.status(429).json({ success: false, message: "请求过于频繁，请稍后再试" });
    return;
  }

  item.count += 1;
  next();
};
