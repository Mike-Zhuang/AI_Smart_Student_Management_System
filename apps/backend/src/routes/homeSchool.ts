import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { fillTemplate, getTemplateById } from "../config/promptTemplates.js";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { callZhipu } from "../services/zhipu.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";

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

const aiReplySchema = z.object({
    apiKey: z.string().min(10),
    model: z.string().min(3)
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
          m.is_read as isRead,
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
          m.is_read as isRead,
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

        logAudit({
            userId: req.user.id,
            actionModule: "home-school",
            actionType: "message_send",
            objectType: "message",
            detail: {
                receiverUserId: input.receiverUserId ?? null,
                receiverRole: input.receiverRole ?? null,
                title: input.title
            },
            ipAddress: extractIp(req)
        });

        res.json({ success: true, message: "消息已发送" });
    }
);

homeSchoolRouter.patch("/messages/:id/read", requireAuth, (req: AuthedRequest, res) => {
    const messageId = Number(req.params.id);
    if (Number.isNaN(messageId) || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const message = db
        .prepare(
            `SELECT id, receiver_user_id as receiverUserId, receiver_role as receiverRole
       FROM messages WHERE id = ?`
        )
        .get(messageId) as { id: number; receiverUserId: number | null; receiverRole: string | null } | undefined;

    if (!message) {
        res.status(404).json({ success: false, message: "消息不存在" });
        return;
    }

    const canRead =
        req.user.role === ROLES.ADMIN ||
        message.receiverUserId === req.user.id ||
        (message.receiverRole !== null && message.receiverRole === req.user.role);

    if (!canRead) {
        res.status(403).json({ success: false, message: "无权限操作" });
        return;
    }

    db
        .prepare(
            `UPDATE messages
         SET is_read = 1
         WHERE id = ?
          AND (receiver_user_id = ? OR receiver_role = ? OR ? = 'admin')`
        )
        .run(messageId, req.user.id, req.user.role, req.user.role);

    logAudit({
        userId: req.user.id,
        actionModule: "home-school",
        actionType: "message_read",
        objectType: "message",
        objectId: messageId,
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: "已标记为已读" });
});

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
                 WHERE lr.parent_user_id = ?
                        OR s.id IN (
                            SELECT student_id FROM parent_student_links WHERE parent_user_id = ?
                        )
         ORDER BY lr.created_at DESC`
            )
            .all(req.user.id, req.user.id);
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

    if (req.user.role === ROLES.PARENT) {
        const canSubmit = db
            .prepare(
                `SELECT 1
                 FROM parent_student_links
                 WHERE parent_user_id = ? AND student_id = ?
                 LIMIT 1`
            )
            .get(req.user.id, input.studentId);

        if (!canSubmit) {
            res.status(403).json({ success: false, message: "家长仅可为已绑定学生提交请假" });
            return;
        }
    }

    db.prepare(
        `INSERT INTO leave_requests (student_id, parent_user_id, reason, start_date, end_date, status, review_note, reviewed_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)`
    ).run(input.studentId, req.user.id, input.reason, input.startDate, input.endDate, dayjs().toISOString());

    logAudit({
        userId: req.user.id,
        actionModule: "home-school",
        actionType: "leave_submit",
        objectType: "leave_request",
        detail: {
            studentId: input.studentId,
            startDate: input.startDate,
            endDate: input.endDate
        },
        ipAddress: extractIp(req)
    });

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

        logAudit({
            userId: req.user.id,
            actionModule: "home-school",
            actionType: "leave_review",
            objectType: "leave_request",
            objectId: leaveId,
            detail: { status: parsed.data.status, reviewNote: parsed.data.reviewNote },
            ipAddress: extractIp(req)
        });

        res.json({ success: true, message: "审核完成" });
    }
);

homeSchoolRouter.post(
    "/messages/:id/ai-reply-draft",
    requireAuth,
    requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER),
    async (req: AuthedRequest, res) => {
        const messageId = Number(req.params.id);
        const parsed = aiReplySchema.safeParse(req.body);
        if (Number.isNaN(messageId) || !parsed.success || !req.user) {
            res.status(400).json({ success: false, message: "参数不合法" });
            return;
        }

        const message = db
            .prepare(
                `SELECT m.id, m.title, m.content, sender.display_name as senderName
                 FROM messages m
                 LEFT JOIN users sender ON sender.id = m.sender_user_id
                 WHERE m.id = ?`
            )
            .get(messageId) as
            | {
                id: number;
                title: string;
                content: string;
                senderName: string | null;
            }
            | undefined;

        if (!message) {
            res.status(404).json({ success: false, message: "消息不存在" });
            return;
        }

        const template = getTemplateById("home-school-reply-v1");
        if (!template) {
            res.status(500).json({ success: false, message: "系统未配置家校回复模板" });
            return;
        }

        const parentMessage = `标题: ${message.title}\n内容: ${message.content}\n发送人: ${message.senderName ?? "家长"}`;
        const prompt = `${fillTemplate(template.template, { parentMessage })}\n\n输出规范:\n${template.outputSpec}`;

        try {
            const answer = await callZhipu({
                apiKey: parsed.data.apiKey,
                model: parsed.data.model,
                prompt,
                systemPrompt: template.systemPrompt,
                enableThinking: parsed.data.model.includes("thinking") || parsed.data.model === "glm-4.7-flash"
            });

            logAudit({
                userId: req.user.id,
                actionModule: "home-school",
                actionType: "ai_reply_draft",
                objectType: "message",
                objectId: messageId,
                detail: { model: parsed.data.model },
                ipAddress: extractIp(req)
            });

            res.json({ success: true, message: "生成成功", data: { messageId, draft: answer } });
        } catch (error) {
            const reason = error instanceof Error ? error.message : "未知错误";
            res.status(502).json({ success: false, message: `模型调用失败: ${reason}` });
        }
    }
);
