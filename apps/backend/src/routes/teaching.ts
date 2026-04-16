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

const createTaskSchema = z.object({
    title: z.string().min(2),
    taskType: z.enum(["lesson_plan", "research", "communication", "training"]),
    dueDate: z.string().min(8)
});

const aiTaskSchema = z.object({
    apiKey: z.string().min(10),
    model: z.string().min(3)
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
    "/tasks/:id/ai-plan",
    requireAuth,
    requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER),
    async (req: AuthedRequest, res) => {
        const taskId = Number(req.params.id);
        const parsed = aiTaskSchema.safeParse(req.body);
        if (Number.isNaN(taskId) || !parsed.success || !req.user) {
            res.status(400).json({ success: false, message: "参数不合法" });
            return;
        }

        const task = db
            .prepare(
                `SELECT t.id, t.title, t.task_type as taskType, t.status, t.due_date as dueDate,
                        u.display_name as teacherName
                 FROM teaching_tasks t
                 JOIN users u ON u.id = t.teacher_user_id
                 WHERE t.id = ?`
            )
            .get(taskId) as
            | {
                id: number;
                title: string;
                taskType: string;
                status: string;
                dueDate: string;
                teacherName: string;
            }
            | undefined;

        if (!task) {
            res.status(404).json({ success: false, message: "任务不存在" });
            return;
        }

        const template = getTemplateById("teaching-research-v1");
        if (!template) {
            res.status(500).json({ success: false, message: "系统未配置教研模板" });
            return;
        }

        const taskData = [
            `任务标题: ${task.title}`,
            `任务类型: ${task.taskType}`,
            `当前状态: ${task.status}`,
            `截止日期: ${task.dueDate}`,
            `负责人: ${task.teacherName}`
        ].join("\n");

        const prompt = `${fillTemplate(template.template, { taskData })}\n\n输出规范:\n${template.outputSpec}`;

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
                actionModule: "teaching",
                actionType: "ai_task_plan",
                objectType: "teaching_task",
                objectId: taskId,
                detail: { model: parsed.data.model },
                ipAddress: extractIp(req)
            });

            res.json({
                success: true,
                message: "生成成功",
                data: {
                    taskId,
                    answer
                }
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : "未知错误";
            res.status(502).json({ success: false, message: `模型调用失败: ${reason}` });
        }
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

        logAudit({
            userId: req.user.id,
            actionModule: "teaching",
            actionType: "task_create",
            objectType: "teaching_task",
            detail: {
                title: parsed.data.title,
                taskType: parsed.data.taskType,
                dueDate: parsed.data.dueDate
            },
            ipAddress: extractIp(req)
        });

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

teachingRouter.get(
    "/head-teacher/workbench",
    requireAuth,
    requireRole(ROLES.ADMIN, ROLES.HEAD_TEACHER),
    (req: AuthedRequest, res) => {
        const className = typeof req.query.className === "string" ? req.query.className : null;

        const classFromQuery = className
            ? className
            : (db.prepare("SELECT class_name as className FROM students GROUP BY class_name ORDER BY class_name LIMIT 1").get() as
                | { className: string }
                | undefined)?.className;

        if (!classFromQuery) {
            res.status(404).json({ success: false, message: "未找到班级数据" });
            return;
        }

        const riskStudents = db
            .prepare(
                `SELECT s.id, s.name, s.class_name as className, gp.risk_level as riskLevel, gp.summary,
                ROUND(AVG(er.score), 1) as avgScore
         FROM students s
         JOIN growth_profiles gp ON gp.student_id = s.id
         LEFT JOIN exam_results er ON er.student_id = s.id
         WHERE s.class_name = ? AND gp.risk_level != 'low'
         GROUP BY s.id, s.name, s.class_name, gp.risk_level, gp.summary
         ORDER BY CASE gp.risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, avgScore ASC
         LIMIT 20`
            )
            .all(classFromQuery);

        const pendingLeaves = db
            .prepare(
                `SELECT COUNT(*) as count
         FROM leave_requests lr
         JOIN students s ON s.id = lr.student_id
         WHERE s.class_name = ? AND lr.status = 'pending'`
            )
            .get(classFromQuery) as { count: number };

        const openAlerts = db
            .prepare(
                `SELECT COUNT(*) as count
         FROM alerts a
         JOIN students s ON s.id = a.student_id
         WHERE s.class_name = ? AND a.status = 'open'`
            )
            .get(classFromQuery) as { count: number };

        const todoTasks = db
            .prepare(
                `SELECT COUNT(*) as count
         FROM teaching_tasks
         WHERE status = 'todo'`
            )
            .get() as { count: number };

        const parentMessages = db
            .prepare(
                `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN is_read = 1 THEN 1 ELSE 0 END) as readCount
         FROM messages
         WHERE receiver_role = ?`
            )
            .get(ROLES.PARENT) as { total: number; readCount: number | null };

        const recentActions = db
            .prepare(
                `SELECT a.id, a.action_module as actionModule, a.action_type as actionType, a.object_type as objectType,
                a.created_at as createdAt, u.display_name as operatorName
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.action_module IN ('home-school', 'growth', 'teaching')
         ORDER BY a.created_at DESC
         LIMIT 8`
            )
            .all();

        const totalParentMessages = parentMessages.total || 0;
        const readCount = parentMessages.readCount || 0;
        const receiptRate = totalParentMessages === 0 ? 1 : Number((readCount / totalParentMessages).toFixed(3));

        res.json({
            success: true,
            message: "查询成功",
            data: {
                className: classFromQuery,
                todoFunnel: [
                    { stage: "待审核请假", count: pendingLeaves.count },
                    { stage: "待跟进预警", count: openAlerts.count },
                    { stage: "待办教学任务", count: todoTasks.count },
                    { stage: "待家长回执", count: totalParentMessages - readCount }
                ],
                riskStudents,
                receiptStats: {
                    totalMessages: totalParentMessages,
                    readMessages: readCount,
                    unreadMessages: totalParentMessages - readCount,
                    receiptRate
                },
                recentActions
            }
        });
    }
);
