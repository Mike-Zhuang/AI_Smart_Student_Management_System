import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const createMessageSchema = z.object({
  receiverUserId: z.number().int().positive().optional(),
  receiverRole: z.enum([ROLES.PARENT, ROLES.STUDENT, ROLES.TEACHER, ROLES.HEAD_TEACHER]).optional(),
  title: z.string().min(2),
  content: z.string().min(2)
});

const createLeaveSchema = z.object({
  studentId: z.number().int().positive(),
  reason: z.string().min(2),
  startDate: z.string().min(8),
  endDate: z.string().min(8)
});

const reviewLeaveSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().min(2)
});

export const homeSchoolRouter = Router();

homeSchoolRouter.get("/messages", requireAuth, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ success: false, message: "未登录" });
    return;
  }

  const user = req.user;
  let rows: unknown[] = [];

  if (user.role === ROLES.ADMIN || user.role === ROLES.TEACHER || user.role === ROLES.HEAD_TEACHER) {
    rows = db
      .prepare(
        `SELECT m.id, m.title, m.content, m.module, m.created_at as createdAt, m.receiver_role as receiverRole,
                sender.display_name as senderName
         FROM messages m
         LEFT JOIN users sender ON sender.id = m.sender_user_id
         ORDER BY m.created_at DESC
         LIMIT 80`
      )
      .all();
  } else {
    rows = db
      .prepare(
        `SELECT m.id, m.title, m.content, m.module, m.created_at as createdAt, m.receiver_role as receiverRole,
                sender.display_name as senderName
         FROM messages m
         LEFT JOIN users sender ON sender.id = m.sender_user_id
         WHERE m.receiver_user_id = ? OR m.receiver_role = ?
         ORDER BY m.created_at DESC
         LIMIT 80`
      )
      .all(user.id, user.role);
  }

  res.json({ success: true, message: "查询成功", data: rows });
});

homeSchoolRouter.post(
  "/messages",
  requireAuth,
  requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER),
  (req: AuthedRequest, res) => {
    const parsed = createMessageSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      res.status(400).json({ success: false, message: "参数不合法" });
      return;
    }

    const input = parsed.data;
    db.prepare(
      `INSERT INTO messages (sender_user_id, receiver_user_id, receiver_role, title, content, module, created_at, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(req.user.id, input.receiverUserId ?? null, input.receiverRole ?? null, input.title, input.content, "home-school", dayjs().toISOString());

    res.json({ success: true, message: "消息已发送" });
  }
);

homeSchoolRouter.get("/leave-requests", requireAuth, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ success: false, message: "未登录" });
    return;
  }

  let rows: unknown[] = [];
  if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.TEACHER || req.user.role === ROLES.HEAD_TEACHER) {
    rows = db
      .prepare(
        `SELECT lr.id, lr.reason, lr.start_date as startDate, lr.end_date as endDate, lr.status,
                lr.review_note as reviewNote, s.name as studentName, s.class_name as className
         FROM leave_requests lr
         JOIN students s ON s.id = lr.student_id
         ORDER BY lr.created_at DESC`
      )
      .all();
  } else {
    rows = db
      .prepare(
        `SELECT lr.id, lr.reason, lr.start_date as startDate, lr.end_date as endDate, lr.status,
                lr.review_note as reviewNote, s.name as studentName, s.class_name as className
         FROM leave_requests lr
         JOIN students s ON s.id = lr.student_id
         WHERE lr.parent_user_id = ? OR s.id = ?
         ORDER BY lr.created_at DESC`
      )
      .all(req.user.id, req.user.linkedStudentId ?? -1);
  }

  res.json({ success: true, message: "查询成功", data: rows });
});

homeSchoolRouter.post("/leave-requests", requireAuth, (req: AuthedRequest, res) => {
  const parsed = createLeaveSchema.safeParse(req.body);
  if (!parsed.success || !req.user) {
    res.status(400).json({ success: false, message: "参数不合法" });
    return;
  }

  const input = parsed.data;
  db.prepare(
    `INSERT INTO leave_requests (student_id, parent_user_id, reason, start_date, end_date, status, review_note, reviewed_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)`
  ).run(input.studentId, req.user.id, input.reason, input.startDate, input.endDate, dayjs().toISOString());

  res.json({ success: true, message: "请假申请已提交" });
});

homeSchoolRouter.patch(
  "/leave-requests/:id/review",
  requireAuth,
  requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER),
  (req: AuthedRequest, res) => {
    const parsed = reviewLeaveSchema.safeParse(req.body);
    const leaveId = Number(req.params.id);
    if (!parsed.success || Number.isNaN(leaveId) || !req.user) {
      res.status(400).json({ success: false, message: "参数不合法" });
      return;
    }

    db.prepare(
      `UPDATE leave_requests
       SET status = ?, review_note = ?, reviewed_by = ?
       WHERE id = ?`
    ).run(parsed.data.status, parsed.data.reviewNote, req.user.id, leaveId);

    res.json({ success: true, message: "审核完成" });
  }
);
