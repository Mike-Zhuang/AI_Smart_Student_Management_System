import { randomBytes } from "node:crypto";
import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const createInviteSchema = z.object({
  role: z.enum([ROLES.TEACHER, ROLES.HEAD_TEACHER, ROLES.PARENT, ROLES.STUDENT]),
  count: z.number().int().min(1).max(50),
  expiresInDays: z.number().int().min(1).max(365)
});

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole(ROLES.ADMIN));

adminRouter.post("/invite-codes", (req, res) => {
  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "参数不合法" });
    return;
  }

  const output: string[] = [];
  const stmt = db.prepare(
    `INSERT INTO invite_codes (code, role, expires_at, used, created_at)
     VALUES (?, ?, ?, 0, ?)`
  );

  for (let i = 0; i < parsed.data.count; i += 1) {
    const code = `${parsed.data.role.toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
    output.push(code);
    stmt.run(code, parsed.data.role, dayjs().add(parsed.data.expiresInDays, "day").toISOString(), dayjs().toISOString());
  }

  res.json({ success: true, message: "邀请码生成成功", data: output });
});

adminRouter.get("/invite-codes", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, code, role, expires_at as expiresAt, used, created_at as createdAt
       FROM invite_codes
       ORDER BY created_at DESC
       LIMIT 200`
    )
    .all();

  res.json({ success: true, message: "查询成功", data: rows });
});

adminRouter.get("/system-overview", (_req, res) => {
  const users = db.prepare("SELECT role, COUNT(*) as count FROM users GROUP BY role").all();
  const students = db.prepare("SELECT COUNT(*) as count FROM students").get() as { count: number };
  const messages = db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number };

  res.json({
    success: true,
    message: "查询成功",
    data: {
      users,
      studentCount: students.count,
      messageCount: messages.count
    }
  });
});
