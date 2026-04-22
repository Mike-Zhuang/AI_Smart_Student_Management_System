import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { fillTemplate, getTemplateById } from "../config/promptTemplates.js";
import { getSupportedModelById, ROLES } from "../constants.js";
import { db } from "../db.js";
import { canAccessStudent, requireAuth, requireRole } from "../middleware/auth.js";
import { callZhipu } from "../services/zhipu.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";
import { normalizeClassName, repairText } from "../utils/text.js";

const createMessageSchema = z.object({
    receiverUserId: z.number().int().positive().optional(),
    receiverRole: z.enum([ROLES.PARENT, ROLES.STUDENT, ROLES.TEACHER, ROLES.HEAD_TEACHER]).optional(),
    title: z.string().min(2),
    content: z.string().min(2)
});

const createLeaveSchema = z.object({
    studentId: z.number().int().positive(),
    leaveType: z.enum(["sick", "personal", "other"]).default("personal"),
    reason: z.string().min(2),
    startAt: z.string().min(8),
    endAt: z.string().min(8),
    contactPhone: z.string().min(6),
    emergencyContact: z.string().min(2)
});

const parentConfirmSchema = z.object({
    status: z.enum(["confirmed", "returned"]),
    note: z.string().min(2)
});

const reviewLeaveSchema = z.object({
    status: z.enum(["approved", "rejected"]),
    reviewNote: z.string().min(2)
});

const completeLeaveSchema = z.object({
    completionNote: z.string().min(2).optional()
});

const batchDeleteSchema = z.object({
    ids: z.array(z.number().int().positive()).min(1)
});

const aiReplySchema = z.object({
    apiKey: z.string().min(10),
    model: z.string().min(3)
});

export const homeSchoolRouter = Router();

const getManageableClasses = (userId: number): string[] => {
    return (db
        .prepare(
            `SELECT class_name as className
             FROM teacher_class_links
             WHERE teacher_user_id = ?`
        )
        .all(userId) as Array<{ className: string }>).map((item) => item.className);
};

const getLeaveById = (leaveId: number) => {
    return db
        .prepare(
            `SELECT lr.id, lr.student_id as studentId, lr.parent_user_id as parentUserId, lr.requester_user_id as requesterUserId,
                    lr.requester_role as requesterRole, lr.leave_type as leaveType, lr.reason,
                    COALESCE(lr.start_at, lr.start_date) as startAt,
                    COALESCE(lr.end_at, lr.end_date) as endAt,
                    lr.contact_phone as contactPhone, lr.emergency_contact as emergencyContact,
                    lr.status, lr.parent_confirm_status as parentConfirmStatus, lr.parent_confirm_note as parentConfirmNote,
                    lr.parent_confirmed_at as parentConfirmedAt, lr.review_status as reviewStatus, lr.review_note as reviewNote,
                    lr.reviewed_by as reviewedBy, lr.reviewed_at as reviewedAt, lr.completion_status as completionStatus,
                    lr.completed_at as completedAt, lr.created_at as createdAt,
                    s.name as studentName, s.class_name as className
             FROM leave_requests lr
             JOIN students s ON s.id = lr.student_id
             WHERE lr.id = ?`
        )
        .get(leaveId) as
        | {
            id: number;
            studentId: number;
            parentUserId: number | null;
            requesterUserId: number | null;
            requesterRole: string | null;
            leaveType: string;
            reason: string;
            startAt: string;
            endAt: string;
            contactPhone: string | null;
            emergencyContact: string | null;
            status: string;
            parentConfirmStatus: string | null;
            parentConfirmNote: string | null;
            parentConfirmedAt: string | null;
            reviewStatus: string | null;
            reviewNote: string | null;
            reviewedBy: number | null;
            reviewedAt: string | null;
            completionStatus: string | null;
            completedAt: string | null;
            createdAt: string;
            studentName: string;
            className: string;
        }
        | undefined;
};

const buildLeaveTimeline = (leave: NonNullable<ReturnType<typeof getLeaveById>>) => {
    return [
        {
            step: "学生提交",
            status: "done",
            note: leave.requesterRole === ROLES.STUDENT ? "学生已提交请假申请" : "家长代为提交申请",
            time: leave.createdAt
        },
        {
            step: "家长确认",
            status:
                leave.parentConfirmStatus === "confirmed"
                    ? "done"
                    : leave.parentConfirmStatus === "returned"
                        ? "returned"
                        : "pending",
            note: leave.parentConfirmNote,
            time: leave.parentConfirmedAt
        },
        {
            step: "班主任审批",
            status:
                leave.reviewStatus === "approved"
                    ? "done"
                    : leave.reviewStatus === "rejected"
                        ? "returned"
                        : leave.status === "pending_head_teacher_review"
                            ? "pending"
                            : "waiting",
            note: leave.reviewNote,
            time: leave.reviewedAt
        },
        {
            step: "返校销假",
            status: leave.completionStatus === "completed" ? "done" : leave.status === "approved" ? "pending" : "waiting",
            note: leave.completionStatus === "completed" ? "已完成返校销假" : null,
            time: leave.completedAt
        }
    ];
};

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
                        m.is_read as isRead, sender.display_name as senderName
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
                        m.is_read as isRead, sender.display_name as senderName
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

homeSchoolRouter.post("/messages", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (req: AuthedRequest, res) => {
    const parsed = createMessageSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const input = parsed.data;
    db.prepare(
        `INSERT INTO messages (sender_user_id, receiver_user_id, receiver_role, title, content, module, created_at, is_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
        req.user.id,
        input.receiverUserId ?? null,
        input.receiverRole ?? null,
        repairText(input.title),
        repairText(input.content),
        "home-school",
        dayjs().toISOString()
    );

    logAudit({
        userId: req.user.id,
        actionModule: "home-school",
        actionType: "message_send",
        objectType: "message",
        detail: input,
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: "消息已发送" });
});

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

    db.prepare("UPDATE messages SET is_read = 1 WHERE id = ?").run(messageId);
    res.json({ success: true, message: "已标记为已读" });
});

homeSchoolRouter.get("/leave-requests", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    let rows: Array<Record<string, unknown>> = [];
    if (req.user.role === ROLES.ADMIN) {
        rows = db
            .prepare(
                `SELECT lr.id, s.id as studentId, s.name as studentName, s.class_name as className,
                        lr.leave_type as leaveType, lr.reason,
                        COALESCE(lr.start_at, lr.start_date) as startAt,
                        COALESCE(lr.end_at, lr.end_date) as endAt,
                        lr.contact_phone as contactPhone, lr.emergency_contact as emergencyContact,
                        lr.status, lr.parent_confirm_status as parentConfirmStatus, lr.parent_confirm_note as parentConfirmNote,
                        lr.parent_confirmed_at as parentConfirmedAt, lr.review_status as reviewStatus, lr.review_note as reviewNote,
                        lr.reviewed_at as reviewedAt, lr.completion_status as completionStatus, lr.completed_at as completedAt,
                        lr.created_at as createdAt
                 FROM leave_requests lr
                 JOIN students s ON s.id = lr.student_id
                 ORDER BY lr.created_at DESC`
            )
            .all() as Array<Record<string, unknown>>;
    } else if (req.user.role === ROLES.HEAD_TEACHER) {
        const classes = getManageableClasses(req.user.id);
        if (classes.length > 0) {
            rows = db
                .prepare(
                    `SELECT lr.id, s.id as studentId, s.name as studentName, s.class_name as className,
                            lr.leave_type as leaveType, lr.reason,
                            COALESCE(lr.start_at, lr.start_date) as startAt,
                            COALESCE(lr.end_at, lr.end_date) as endAt,
                            lr.contact_phone as contactPhone, lr.emergency_contact as emergencyContact,
                            lr.status, lr.parent_confirm_status as parentConfirmStatus, lr.parent_confirm_note as parentConfirmNote,
                            lr.parent_confirmed_at as parentConfirmedAt, lr.review_status as reviewStatus, lr.review_note as reviewNote,
                            lr.reviewed_at as reviewedAt, lr.completion_status as completionStatus, lr.completed_at as completedAt,
                            lr.created_at as createdAt
                     FROM leave_requests lr
                     JOIN students s ON s.id = lr.student_id
                     WHERE s.class_name IN (${classes.map(() => "?").join(",")})
                     ORDER BY lr.created_at DESC`
                )
                .all(...classes) as Array<Record<string, unknown>>;
        }
    } else if (req.user.role === ROLES.TEACHER) {
        const classes = getManageableClasses(req.user.id);
        if (classes.length > 0) {
            rows = db
                .prepare(
                    `SELECT lr.id, s.id as studentId, s.name as studentName, s.class_name as className,
                            lr.leave_type as leaveType, lr.reason,
                            COALESCE(lr.start_at, lr.start_date) as startAt,
                            COALESCE(lr.end_at, lr.end_date) as endAt,
                            lr.contact_phone as contactPhone, lr.emergency_contact as emergencyContact,
                            lr.status, lr.parent_confirm_status as parentConfirmStatus, lr.parent_confirm_note as parentConfirmNote,
                            lr.parent_confirmed_at as parentConfirmedAt, lr.review_status as reviewStatus, lr.review_note as reviewNote,
                            lr.reviewed_at as reviewedAt, lr.completion_status as completionStatus, lr.completed_at as completedAt,
                            lr.created_at as createdAt
                     FROM leave_requests lr
                     JOIN students s ON s.id = lr.student_id
                     WHERE s.class_name IN (${classes.map(() => "?").join(",")})
                     ORDER BY lr.created_at DESC`
                )
                .all(...classes) as Array<Record<string, unknown>>;
        }
    } else if (req.user.role === ROLES.PARENT) {
        rows = db
            .prepare(
                `SELECT lr.id, s.id as studentId, s.name as studentName, s.class_name as className,
                        lr.leave_type as leaveType, lr.reason,
                        COALESCE(lr.start_at, lr.start_date) as startAt,
                        COALESCE(lr.end_at, lr.end_date) as endAt,
                        lr.contact_phone as contactPhone, lr.emergency_contact as emergencyContact,
                        lr.status, lr.parent_confirm_status as parentConfirmStatus, lr.parent_confirm_note as parentConfirmNote,
                        lr.parent_confirmed_at as parentConfirmedAt, lr.review_status as reviewStatus, lr.review_note as reviewNote,
                        lr.reviewed_at as reviewedAt, lr.completion_status as completionStatus, lr.completed_at as completedAt,
                        lr.created_at as createdAt
                 FROM leave_requests lr
                 JOIN students s ON s.id = lr.student_id
                 WHERE s.id IN (
                    SELECT student_id FROM parent_student_links WHERE parent_user_id = ?
                 )
                 ORDER BY lr.created_at DESC`
            )
            .all(req.user.id) as Array<Record<string, unknown>>;
    } else {
        rows = db
            .prepare(
                `SELECT lr.id, s.id as studentId, s.name as studentName, s.class_name as className,
                        lr.leave_type as leaveType, lr.reason,
                        COALESCE(lr.start_at, lr.start_date) as startAt,
                        COALESCE(lr.end_at, lr.end_date) as endAt,
                        lr.contact_phone as contactPhone, lr.emergency_contact as emergencyContact,
                        lr.status, lr.parent_confirm_status as parentConfirmStatus, lr.parent_confirm_note as parentConfirmNote,
                        lr.parent_confirmed_at as parentConfirmedAt, lr.review_status as reviewStatus, lr.review_note as reviewNote,
                        lr.reviewed_at as reviewedAt, lr.completion_status as completionStatus, lr.completed_at as completedAt,
                        lr.created_at as createdAt
                 FROM leave_requests lr
                 JOIN students s ON s.id = lr.student_id
                 WHERE s.id = ?
                 ORDER BY lr.created_at DESC`
            )
            .all(req.user.linkedStudentId ?? -1) as Array<Record<string, unknown>>;
    }

    const enriched = rows.map((row) => {
        const leave = getLeaveById(Number(row.id));
        return leave ? { ...row, timeline: buildLeaveTimeline(leave) } : row;
    });

    res.json({ success: true, message: "查询成功", data: enriched });
});

homeSchoolRouter.post("/leave-requests", requireAuth, (req: AuthedRequest, res) => {
    const parsed = createLeaveSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const input = parsed.data;
    if (!canAccessStudent(req, input.studentId)) {
        res.status(403).json({ success: false, message: "无权为该学生发起请假" });
        return;
    }

    if (req.user.role !== ROLES.STUDENT && req.user.role !== ROLES.PARENT && req.user.role !== ROLES.ADMIN && req.user.role !== ROLES.HEAD_TEACHER) {
        res.status(403).json({ success: false, message: "当前身份不可发起请假" });
        return;
    }

    const student = db
        .prepare("SELECT id, name FROM students WHERE id = ?")
        .get(input.studentId) as { id: number; name: string } | undefined;
    if (!student) {
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }

    const isParentInitiated = req.user.role === ROLES.PARENT || req.user.role === ROLES.ADMIN || req.user.role === ROLES.HEAD_TEACHER;
    db.prepare(
        `INSERT INTO leave_requests (
            student_id, parent_user_id, requester_user_id, requester_role, leave_type, reason,
            start_date, end_date, start_at, end_at, contact_phone, emergency_contact,
            status, parent_confirm_status, parent_confirm_note, parent_confirmed_at,
            review_status, review_note, reviewed_by, reviewed_at, completion_status, completed_at, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        input.studentId,
        req.user.role === ROLES.PARENT ? req.user.id : null,
        req.user.id,
        req.user.role,
        input.leaveType,
        repairText(input.reason),
        input.startAt.slice(0, 10),
        input.endAt.slice(0, 10),
        input.startAt,
        input.endAt,
        repairText(input.contactPhone),
        repairText(input.emergencyContact),
        isParentInitiated ? "pending_head_teacher_review" : "pending_parent_confirm",
        isParentInitiated ? "confirmed" : "pending",
        isParentInitiated ? "家长已确认信息" : null,
        isParentInitiated ? dayjs().toISOString() : null,
        isParentInitiated ? "pending_head_teacher_review" : null,
        null,
        null,
        null,
        "pending",
        null,
        dayjs().toISOString()
    );

    logAudit({
        userId: req.user.id,
        actionModule: "home-school",
        actionType: "leave_submit",
        objectType: "leave_request",
        detail: { studentId: input.studentId, studentName: student.name, leaveType: input.leaveType },
        ipAddress: extractIp(req)
    });

    res.json({
        success: true,
        message: isParentInitiated ? "请假申请已提交，待班主任审批" : "请假申请已提交，待家长确认"
    });
});

homeSchoolRouter.patch("/leave-requests/:id/parent-confirm", requireAuth, (req: AuthedRequest, res) => {
    const leaveId = Number(req.params.id);
    const parsed = parentConfirmSchema.safeParse(req.body);
    if (Number.isNaN(leaveId) || !parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const leave = getLeaveById(leaveId);
    if (!leave) {
        res.status(404).json({ success: false, message: "请假记录不存在" });
        return;
    }

    if (req.user.role !== ROLES.PARENT || !canAccessStudent(req, leave.studentId)) {
        res.status(403).json({ success: false, message: "仅关联家长可确认请假" });
        return;
    }

    const nextStatus = parsed.data.status === "confirmed" ? "pending_head_teacher_review" : "cancelled";
    db.prepare(
        `UPDATE leave_requests
         SET parent_user_id = ?, parent_confirm_status = ?, parent_confirm_note = ?, parent_confirmed_at = ?,
             review_status = ?, status = ?
         WHERE id = ?`
    ).run(
        req.user.id,
        parsed.data.status,
        repairText(parsed.data.note),
        dayjs().toISOString(),
        parsed.data.status === "confirmed" ? "pending_head_teacher_review" : "rejected",
        nextStatus,
        leaveId
    );

    res.json({ success: true, message: parsed.data.status === "confirmed" ? "家长已确认，待班主任审批" : "家长已退回请假申请" });
});

homeSchoolRouter.patch("/leave-requests/:id/review", requireAuth, requireRole(ROLES.ADMIN, ROLES.HEAD_TEACHER), (req: AuthedRequest, res) => {
    const leaveId = Number(req.params.id);
    const parsed = reviewLeaveSchema.safeParse(req.body);
    if (!parsed.success || Number.isNaN(leaveId) || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const leave = getLeaveById(leaveId);
    if (!leave) {
        res.status(404).json({ success: false, message: "请假记录不存在" });
        return;
    }

    if (req.user.role === ROLES.HEAD_TEACHER) {
        const classes = getManageableClasses(req.user.id).map(normalizeClassName);
        if (!classes.includes(normalizeClassName(leave.className))) {
            res.status(403).json({ success: false, message: "无权审批该班学生请假" });
            return;
        }
    }

    db.prepare(
        `UPDATE leave_requests
         SET review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, status = ?
         WHERE id = ?`
    ).run(parsed.data.status, repairText(parsed.data.reviewNote), req.user.id, dayjs().toISOString(), parsed.data.status, leaveId);

    res.json({ success: true, message: parsed.data.status === "approved" ? "请假已批准" : "请假已驳回" });
});

homeSchoolRouter.patch("/leave-requests/:id/complete", requireAuth, (req: AuthedRequest, res) => {
    const leaveId = Number(req.params.id);
    const parsed = completeLeaveSchema.safeParse(req.body);
    if (Number.isNaN(leaveId) || !parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const leave = getLeaveById(leaveId);
    if (!leave) {
        res.status(404).json({ success: false, message: "请假记录不存在" });
        return;
    }

    const canComplete = req.user.role === ROLES.ADMIN || (req.user.role === ROLES.STUDENT && req.user.linkedStudentId === leave.studentId);
    if (!canComplete) {
        res.status(403).json({ success: false, message: "仅学生本人可执行返校销假" });
        return;
    }

    db.prepare(
        `UPDATE leave_requests
         SET completion_status = 'completed', completed_at = ?, status = 'completed', review_note = COALESCE(review_note, ?)
         WHERE id = ?`
    ).run(dayjs().toISOString(), repairText(parsed.data.completionNote ?? "学生已返校销假"), leaveId);

    res.json({ success: true, message: "已完成返校销假" });
});

homeSchoolRouter.patch("/leave-requests/:id/cancel", requireAuth, (req: AuthedRequest, res) => {
    const leaveId = Number(req.params.id);
    if (Number.isNaN(leaveId) || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const leave = getLeaveById(leaveId);
    if (!leave) {
        res.status(404).json({ success: false, message: "请假记录不存在" });
        return;
    }

    if (req.user.role !== ROLES.STUDENT || req.user.linkedStudentId !== leave.studentId) {
        res.status(403).json({ success: false, message: "仅学生本人可撤回请假" });
        return;
    }

    if (leave.status !== "pending_parent_confirm") {
        res.status(400).json({ success: false, message: "当前阶段不可撤回，请联系班主任处理" });
        return;
    }

    db.prepare("UPDATE leave_requests SET status = 'cancelled' WHERE id = ?").run(leaveId);
    res.json({ success: true, message: "请假申请已撤回" });
});

homeSchoolRouter.post("/leave-requests/batch-delete", requireAuth, requireRole(ROLES.ADMIN, ROLES.HEAD_TEACHER), (req: AuthedRequest, res) => {
    const parsed = batchDeleteSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const rows = db
        .prepare(
            `SELECT lr.id, s.class_name as className
             FROM leave_requests lr
             JOIN students s ON s.id = lr.student_id
             WHERE lr.id IN (${parsed.data.ids.map(() => "?").join(",")})`
        )
        .all(...parsed.data.ids) as Array<{ id: number; className: string }>;

    if (req.user.role === ROLES.HEAD_TEACHER) {
        const classes = getManageableClasses(req.user.id).map(normalizeClassName);
        const forbidden = rows.find((item) => !classes.includes(normalizeClassName(item.className)));
        if (forbidden) {
            res.status(403).json({ success: false, message: "存在无权删除的请假记录" });
            return;
        }
    }

    db.prepare(`DELETE FROM leave_requests WHERE id IN (${parsed.data.ids.map(() => "?").join(",")})`).run(...parsed.data.ids);
    res.json({ success: true, message: `已删除 ${parsed.data.ids.length} 条请假记录` });
});

homeSchoolRouter.post("/messages/:id/ai-reply-draft", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), async (req: AuthedRequest, res) => {
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
        .get(messageId) as { id: number; title: string; content: string; senderName: string | null } | undefined;

    if (!message) {
        res.status(404).json({ success: false, message: "消息不存在" });
        return;
    }

    const template = getTemplateById("home-school-reply-v1");
    if (!template) {
        res.status(500).json({ success: false, message: "系统未配置家校回复模板" });
        return;
    }

    const modelMeta = getSupportedModelById(parsed.data.model);
    if (!modelMeta) {
        res.status(400).json({ success: false, message: "不支持的模型" });
        return;
    }

    const prompt = `${fillTemplate(template.template, {
        parentMessage: `标题: ${message.title}\n内容: ${message.content}\n发送人: ${message.senderName ?? "家长"}`
    })}\n\n输出规范:\n${template.outputSpec}`;

    try {
        const result = await callZhipu({
            apiKey: parsed.data.apiKey,
            model: parsed.data.model,
            prompt,
            systemPrompt: template.systemPrompt,
            responseFormat: template.outputFormat,
            enableThinking: modelMeta.thinking
        });

        res.json({ success: true, message: "生成成功", data: { draft: result.content } });
    } catch (error) {
        const reason = error instanceof Error ? error.message : "未知错误";
        res.status(502).json({ success: false, message: `模型调用失败: ${reason}` });
    }
});
