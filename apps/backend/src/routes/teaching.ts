import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const createTaskSchema = z.object({
  title: z.string().min(2),
  taskType: z.enum(["lesson_plan", "research", "communication", "training"]),
  dueDate: z.string().min(8)
});

export const teachingRouter = Router();

teachingRouter.get(
  "/tasks",
  requireAuth,
  requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER),
  (req: AuthedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "未登录" });
      return;
    }

    const rows = req.user.role === ROLES.ADMIN
      ? db
          .prepare(
            `SELECT t.id, t.title, t.task_type as taskType, t.status, t.due_date as dueDate, t.created_at as createdAt,
                    u.display_name as teacherName
             FROM teaching_tasks t
             JOIN users u ON u.id = t.teacher_user_id
             ORDER BY t.created_at DESC`
          )
          .all()
      : db
          .prepare(
            `SELECT id, title, task_type as taskType, status, due_date as dueDate, created_at as createdAt
             FROM teaching_tasks
             WHERE teacher_user_id = ?
             ORDER BY created_at DESC`
          )
          .all(req.user.id);

    res.json({ success: true, message: "查询成功", data: rows });
  }
);

teachingRouter.post(
  "/tasks",
  requireAuth,
  requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER),
  (req: AuthedRequest, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      res.status(400).json({ success: false, message: "参数不合法" });
      return;
    }

    db.prepare(
      `INSERT INTO teaching_tasks (teacher_user_id, title, task_type, status, due_date, created_at)
       VALUES (?, ?, ?, 'todo', ?, ?)`
    ).run(req.user.id, parsed.data.title, parsed.data.taskType, parsed.data.dueDate, dayjs().toISOString());

    res.json({ success: true, message: "任务创建成功" });
  }
);

teachingRouter.get(
  "/research",
  requireAuth,
  requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER),
  (req: AuthedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "未登录" });
      return;
    }

    const rows = req.user.role === ROLES.ADMIN
      ? db
          .prepare(
            `SELECT tr.id, tr.title, tr.content, tr.category, tr.performance_score as performanceScore, tr.created_at as createdAt,
                    u.display_name as teacherName
             FROM teaching_research tr
             JOIN users u ON u.id = tr.teacher_user_id
             ORDER BY tr.performance_score DESC`
          )
          .all()
      : db
          .prepare(
            `SELECT id, title, content, category, performance_score as performanceScore, created_at as createdAt
             FROM teaching_research
             WHERE teacher_user_id = ?
             ORDER BY performance_score DESC`
          )
          .all(req.user.id);

    res.json({ success: true, message: "查询成功", data: rows });
  }
);

teachingRouter.get(
  "/analytics",
  requireAuth,
  requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER),
  (_req, res) => {
    const taskStats = db
      .prepare(
        `SELECT status, COUNT(*) as count
         FROM teaching_tasks
         GROUP BY status`
      )
      .all();

    const avgPerformance = db
      .prepare(
        `SELECT ROUND(AVG(performance_score), 2) as avgScore
         FROM teaching_research`
      )
      .get() as { avgScore: number | null };

    res.json({
      success: true,
      message: "查询成功",
      data: {
        taskStats,
        avgResearchScore: avgPerformance.avgScore ?? 0
      }
    });
  }
);
