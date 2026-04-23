import { randomBytes } from "node:crypto";
import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { securityConfig } from "../config/security.js";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";
import { toCsv } from "../utils/export.js";

const createInviteSchema = z.object({
    role: z.enum([ROLES.TEACHER, ROLES.HEAD_TEACHER, ROLES.PARENT, ROLES.STUDENT]),
    count: z.number().int().min(1).max(50),
    expiresInDays: z.number().int().min(1).max(365)
});

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole(ROLES.ADMIN));

adminRouter.post("/invite-codes", (req, res) => {
    const authedReq = req as AuthedRequest;
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

    if (authedReq.user) {
        logAudit({
            userId: authedReq.user.id,
            actionModule: "admin",
            actionType: "generate_invites",
            objectType: "invite_code",
            detail: parsed.data,
            ipAddress: extractIp(req)
        });
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
    const users = db.prepare("SELECT role, COUNT(*) as count FROM users WHERE username != '__system_audit__' GROUP BY role").all();
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

adminRouter.get("/audit-logs", (req, res) => {
    const module = typeof req.query.module === "string" ? req.query.module : null;
    const requestedLimit = Number(req.query.limit ?? 200);
    const limit = Number.isNaN(requestedLimit) ? 200 : Math.min(Math.max(requestedLimit, 1), securityConfig.auditQueryMaxLimit);

    const rows = module
        ? db
            .prepare(
                `SELECT a.id, a.action_module as actionModule, a.action_type as actionType,
                  a.object_type as objectType, a.object_id as objectId, a.detail,
                  a.ip_address as ipAddress, a.created_at as createdAt,
                  u.display_name as operatorName
           FROM audit_logs a
           LEFT JOIN users u ON u.id = a.user_id
           WHERE a.action_module = ?
           ORDER BY a.created_at DESC
           LIMIT ?`
            )
            .all(module, limit)
        : db
            .prepare(
                `SELECT a.id, a.action_module as actionModule, a.action_type as actionType,
                  a.object_type as objectType, a.object_id as objectId, a.detail,
                  a.ip_address as ipAddress, a.created_at as createdAt,
                  u.display_name as operatorName
           FROM audit_logs a
           LEFT JOIN users u ON u.id = a.user_id
           ORDER BY a.created_at DESC
           LIMIT ?`
            )
            .all(limit);

    res.json({ success: true, message: "查询成功", data: rows });
});

const outputExport = (
    res: import("express").Response,
    filename: string,
    rows: Array<Record<string, unknown>>,
    format: "csv" | "json"
): void => {
    if (format === "json") {
        const content = JSON.stringify(rows, null, 2);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename=\"${filename}.json\"`);
        res.send(content);
        return;
    }

    const content = toCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}.csv\"`);
    res.send(content);
};

adminRouter.get("/export/audit-logs", (req, res) => {
    const authedReq = req as AuthedRequest;
    const format = req.query.format === "json" ? "json" : "csv";
    const module = typeof req.query.module === "string" ? req.query.module : null;
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : null;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : null;

    let rows = db
        .prepare(
            `SELECT a.id, a.action_module as actionModule, a.action_type as actionType,
              a.object_type as objectType, a.object_id as objectId, a.detail,
              a.ip_address as ipAddress, a.created_at as createdAt,
              u.display_name as operatorName
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC`
        )
        .all() as Array<Record<string, unknown>>;

    if (module) {
        rows = rows.filter((item) => item.actionModule === module);
    }
    if (startDate) {
        rows = rows.filter((item) => String(item.createdAt) >= startDate);
    }
    if (endDate) {
        rows = rows.filter((item) => String(item.createdAt) <= `${endDate}T23:59:59.999Z`);
    }

    if (authedReq.user) {
        logAudit({
            userId: authedReq.user.id,
            actionModule: "admin",
            actionType: "export_audit_logs",
            objectType: "export",
            detail: { format, module, startDate, endDate, rowCount: rows.length },
            ipAddress: extractIp(req)
        });
    }

    outputExport(res, `audit-logs-${dayjs().format("YYYYMMDD-HHmmss")}`, rows, format);
});

adminRouter.get("/export/module/:module", (req, res) => {
    const authedReq = req as AuthedRequest;
    const module = req.params.module;
    const format = req.query.format === "json" ? "json" : "csv";

    let rows: Array<Record<string, unknown>> = [];
    switch (module) {
        case "messages":
            rows = db
                .prepare(
                    `SELECT id, sender_user_id as senderUserId, receiver_user_id as receiverUserId, receiver_role as receiverRole,
                  title, content, module, created_at as createdAt, is_read as isRead
           FROM messages
           ORDER BY created_at DESC`
                )
                .all() as Array<Record<string, unknown>>;
            break;
        case "leave-requests":
            rows = db
                .prepare(
                    `SELECT lr.id, s.name as studentName, lr.reason, lr.start_date as startDate, lr.end_date as endDate,
                  lr.status, lr.review_note as reviewNote, lr.created_at as createdAt
           FROM leave_requests lr
           JOIN students s ON s.id = lr.student_id
           ORDER BY lr.created_at DESC`
                )
                .all() as Array<Record<string, unknown>>;
            break;
        case "career-recommendations":
            rows = db
                .prepare(
                    `SELECT cr.id, s.name as studentName, cr.model, cr.selected_combination as selectedCombination,
                  cr.reasoning, cr.major_suggestions as majorSuggestions, cr.score_breakdown as scoreBreakdown,
                  cr.created_at as createdAt
           FROM career_recommendations cr
           JOIN students s ON s.id = cr.student_id
           ORDER BY cr.created_at DESC`
                )
                .all() as Array<Record<string, unknown>>;
            break;
        case "alerts":
            rows = db
                .prepare(
                    `SELECT a.id, s.name as studentName, a.alert_type as alertType, a.content, a.status, a.created_at as createdAt
           FROM alerts a
           JOIN students s ON s.id = a.student_id
           ORDER BY a.created_at DESC`
                )
                .all() as Array<Record<string, unknown>>;
            break;
        case "class-logs":
            rows = db
                .prepare(
                    `SELECT id, class_name as className, student_name as studentName, category, title, content,
                            record_date as recordDate, created_at as createdAt
                     FROM class_logs
                     ORDER BY created_at DESC`
                )
                .all() as Array<Record<string, unknown>>;
            break;
        default:
            res.status(400).json({ success: false, message: "不支持的导出模块" });
            return;
    }

    if (authedReq.user) {
        logAudit({
            userId: authedReq.user.id,
            actionModule: "admin",
            actionType: "export_module",
            objectType: "export",
            detail: { module, format, rowCount: rows.length },
            ipAddress: extractIp(req)
        });
    }

    outputExport(res, `${module}-${dayjs().format("YYYYMMDD-HHmmss")}`, rows, format);
});

adminRouter.get("/export/evidence-report", (req, res) => {
    const authedReq = req as AuthedRequest;
    const format = req.query.format === "csv" ? "csv" : "json";

    const overview = db.prepare("SELECT role, COUNT(*) as count FROM users WHERE username != '__system_audit__' GROUP BY role").all() as Array<{
        role: string;
        count: number;
    }>;
    const studentCount = (db.prepare("SELECT COUNT(*) as count FROM students").get() as { count: number }).count;
    const messageCount = (db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }).count;
    const recommendationCount = (
        db.prepare("SELECT COUNT(*) as count FROM career_recommendations").get() as { count: number }
    ).count;
    const aiCallCount = (db
        .prepare("SELECT COUNT(*) as count FROM audit_logs WHERE action_module = 'ai'")
        .get() as { count: number }).count;

    const payload = [
        {
            generatedAt: dayjs().toISOString(),
            studentCount,
            messageCount,
            recommendationCount,
            aiCallCount,
            roleDistribution: JSON.stringify(overview)
        }
    ];

    if (authedReq.user) {
        logAudit({
            userId: authedReq.user.id,
            actionModule: "admin",
            actionType: "export_evidence_report",
            objectType: "export",
            detail: { format },
            ipAddress: extractIp(req)
        });
    }

    outputExport(res, `evidence-report-${dayjs().format("YYYYMMDD-HHmmss")}`, payload, format);
});
