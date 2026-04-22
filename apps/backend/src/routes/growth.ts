import { Router, type Response } from "express";
import { z } from "zod";
import { fillTemplate, getTemplateById } from "../config/promptTemplates.js";
import { getSupportedModelById } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, canAccessStudent } from "../middleware/auth.js";
import { callZhipu, streamZhipu } from "../services/zhipu.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";
import { normalizeExamName, repairText, sanitizeModelInputText } from "../utils/text.js";

export const growthRouter = Router();

const aiDiagnosisSchema = z.object({
    apiKey: z.string().min(10),
    model: z.string().min(3)
});

const initSse = (res: Response): void => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }
};

const sendSse = (res: Response, event: string, payload: unknown): void => {
    if (res.writableEnded) {
        return;
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

growthRouter.get("/students/:studentId/profile", requireAuth, (req: AuthedRequest, res) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId) || !canAccessStudent(req, studentId)) {
        res.status(403).json({ success: false, message: "无权查看该学生档案" });
        return;
    }

    const student = db
        .prepare(
            `SELECT id, student_no as studentNo, name, grade, class_name as className,
              subject_combination as subjectCombination, interests, career_goal as careerGoal
       FROM students WHERE id = ?`
        )
        .get(studentId) as
        | {
            id: number;
            studentNo: string;
            name: string;
            grade: string;
            className: string;
            subjectCombination: string | null;
            interests: string | null;
            careerGoal: string | null;
        }
        | undefined;

    if (!student) {
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }

    const profile = db
        .prepare(
            `SELECT summary, risk_level as riskLevel, last_updated as lastUpdated
       FROM growth_profiles WHERE student_id = ?`
        )
        .get(studentId) as
        | {
            summary: string;
            riskLevel: string;
            lastUpdated: string;
        }
        | undefined;

    res.json({
        success: true,
        message: "查询成功",
        data: {
            student: {
                ...student,
                name: repairText(student.name),
                grade: repairText(student.grade),
                className: repairText(student.className),
                interests: repairText(student.interests ?? ""),
                careerGoal: repairText(student.careerGoal ?? "")
            },
            profile: profile
                ? {
                    ...profile,
                    summary: repairText(profile.summary),
                    riskLevel: repairText(profile.riskLevel)
                }
                : {
                    summary: "暂无成长画像，请先完成数据导入或等待系统生成。",
                    riskLevel: "",
                    lastUpdated: ""
                }
        }
    });
});

growthRouter.get("/students/:studentId/trends", requireAuth, (req: AuthedRequest, res) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId) || !canAccessStudent(req, studentId)) {
        res.status(403).json({ success: false, message: "无权查看该学生趋势数据" });
        return;
    }

    const rows = db
        .prepare(
            `SELECT exam_name as examName, subject, score
       FROM exam_results
       WHERE student_id = ?
       ORDER BY exam_date ASC`
        )
        .all(studentId) as Array<{ examName: string; subject: string; score: number }>;

    const grouped = new Map<string, { examName: string; count: number; total: number }>();
    for (const row of rows) {
        if (!grouped.has(row.examName)) {
            grouped.set(row.examName, { examName: row.examName, count: 0, total: 0 });
        }
        const item = grouped.get(row.examName);
        if (item) {
            item.count += 1;
            item.total += row.score;
        }
    }

    const trend = Array.from(grouped.values()).map((item) => ({
        examName: normalizeExamName(item.examName) || repairText(item.examName),
        avgScore: Number((item.total / item.count).toFixed(1))
    })).filter((item) => item.examName);

    res.json({ success: true, message: "查询成功", data: trend });
});

growthRouter.get("/students/:studentId/alerts", requireAuth, (req: AuthedRequest, res) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId) || !canAccessStudent(req, studentId)) {
        res.status(403).json({ success: false, message: "无权查看该学生预警" });
        return;
    }

    const rows = db
        .prepare(
            `SELECT id, alert_type as alertType, content, status, created_at as createdAt
       FROM alerts WHERE student_id = ?
       ORDER BY created_at DESC`
        )
        .all(studentId);

    res.json({
        success: true,
        message: "查询成功",
        data: (rows as Array<{ id: number; alertType: string; content: string; status: string; createdAt: string }>).map((item) => ({
            ...item,
            alertType: repairText(item.alertType),
            content: repairText(item.content),
            status: repairText(item.status)
        }))
    });
});

growthRouter.post("/students/:studentId/ai-diagnosis", requireAuth, async (req: AuthedRequest, res) => {
    const studentId = Number(req.params.studentId);
    const parsed = aiDiagnosisSchema.safeParse(req.body);
    if (Number.isNaN(studentId) || !parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    if (!canAccessStudent(req, studentId)) {
        res.status(403).json({ success: false, message: "无权分析该学生" });
        return;
    }

    const template = getTemplateById("growth-risk-v1");
    if (!template) {
        res.status(500).json({ success: false, message: "系统未配置成长诊断模板" });
        return;
    }

    const student = db
        .prepare(
            `SELECT id, name, grade, class_name as className, interests, career_goal as careerGoal
       FROM students WHERE id = ?`
        )
        .get(studentId) as
        | { id: number; name: string; grade: string; className: string; interests: string | null; careerGoal: string | null }
        | undefined;

    if (!student) {
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }

    const trends = db
        .prepare(
            `SELECT exam_name as examName, ROUND(AVG(score), 1) as avgScore
       FROM exam_results
       WHERE student_id = ?
       GROUP BY exam_name
       ORDER BY exam_date ASC`
        )
        .all(studentId) as Array<{ examName: string; avgScore: number }>;

    const alerts = db
        .prepare(
            `SELECT alert_type as alertType, content, status
       FROM alerts
       WHERE student_id = ?
       ORDER BY created_at DESC
       LIMIT 6`
        )
        .all(studentId) as Array<{ alertType: string; content: string; status: string }>;

    const studentData = [
        `姓名: ${sanitizeModelInputText(student.name, "暂无有效姓名")}`,
        `班级: ${sanitizeModelInputText(student.grade, "未知年级")} ${sanitizeModelInputText(student.className, "未知班级")}`,
        `兴趣: ${sanitizeModelInputText(student.interests ?? "", "暂无有效兴趣信息")}`,
        `目标: ${sanitizeModelInputText(student.careerGoal ?? "", "暂无有效目标信息")}`,
        `趋势: ${sanitizeModelInputText(trends.map((item) => `${normalizeExamName(item.examName) || sanitizeModelInputText(item.examName, "考试")} : ${item.avgScore}`).join("; "), "暂无有效趋势信息")}`,
        `预警: ${sanitizeModelInputText(alerts.map((item) => `${sanitizeModelInputText(item.alertType, "预警")}-${sanitizeModelInputText(item.content, "内容待确认")}-${sanitizeModelInputText(item.status, "状态待确认")}`).join("; "), "暂无有效预警信息")}`
    ].join("\n");

    const prompt = `${fillTemplate(template.template, { studentData })}\n\n输出规范:\n${template.outputSpec}`;

    const modelMeta = getSupportedModelById(parsed.data.model);
    if (!modelMeta) {
        res.status(400).json({ success: false, message: "不支持的模型" });
        return;
    }

    if (template.outputFormat === "json_object" && !modelMeta.supportsJsonMode) {
        res.status(400).json({ success: false, message: `模型 ${modelMeta.name} 不支持结构化输出` });
        return;
    }

    try {
        const result = await callZhipu({
            apiKey: parsed.data.apiKey,
            model: parsed.data.model,
            prompt,
            systemPrompt: template.systemPrompt,
            responseFormat: template.outputFormat,
            enableThinking: modelMeta.thinking
        });

        logAudit({
            userId: req.user.id,
            actionModule: "growth",
            actionType: "ai_diagnosis",
            objectType: "student",
            objectId: studentId,
            detail: { model: parsed.data.model },
            ipAddress: extractIp(req)
        });

        res.json({
            success: true,
            message: "分析完成",
            data: {
                studentId,
                answer: result.content
            }
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : "未知错误";
        res.status(502).json({ success: false, message: `模型调用失败: ${reason}` });
    }
});

growthRouter.post("/students/:studentId/ai-diagnosis-stream", requireAuth, async (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId) || !canAccessStudent(req, studentId)) {
        res.status(403).json({ success: false, message: "无权分析该学生" });
        return;
    }

    const parsed = aiDiagnosisSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const student = db
        .prepare(
            `SELECT id, name, grade, class_name as className, interests, career_goal as careerGoal
             FROM students
             WHERE id = ?`
        )
        .get(studentId) as
        | {
            id: number;
            name: string;
            grade: string;
            className: string;
            interests: string | null;
            careerGoal: string | null;
        }
        | undefined;

    if (!student) {
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }

    const template = getTemplateById("growth-risk-v1");
    const modelMeta = getSupportedModelById(parsed.data.model);
    if (!template || !modelMeta || !modelMeta.supportsStreaming) {
        res.status(400).json({ success: false, message: "模板或模型不可用" });
        return;
    }

    if (template.outputFormat === "json_object" && !modelMeta.supportsJsonMode) {
        res.status(400).json({ success: false, message: `模型 ${modelMeta.name} 不支持结构化输出` });
        return;
    }

    const trends = db
        .prepare(
            `SELECT exam_name as examName, ROUND(AVG(score), 1) as avgScore
             FROM exam_results
             WHERE student_id = ?
             GROUP BY exam_name
             ORDER BY exam_date ASC`
        )
        .all(studentId) as Array<{ examName: string; avgScore: number }>;

    const alerts = db
        .prepare(
            `SELECT alert_type as alertType, content, status
             FROM alerts
             WHERE student_id = ?
             ORDER BY created_at DESC
             LIMIT 6`
        )
        .all(studentId) as Array<{ alertType: string; content: string; status: string }>;

    const studentData = [
        `姓名: ${sanitizeModelInputText(student.name, "暂无有效姓名")}`,
        `班级: ${sanitizeModelInputText(student.grade, "未知年级")} ${sanitizeModelInputText(student.className, "未知班级")}`,
        `兴趣: ${sanitizeModelInputText(student.interests ?? "", "暂无有效兴趣信息")}`,
        `目标: ${sanitizeModelInputText(student.careerGoal ?? "", "暂无有效目标信息")}`,
        `趋势: ${sanitizeModelInputText(trends.map((item) => `${normalizeExamName(item.examName) || sanitizeModelInputText(item.examName, "考试")} : ${item.avgScore}`).join("; "), "暂无有效趋势信息")}`,
        `预警: ${sanitizeModelInputText(alerts.map((item) => `${sanitizeModelInputText(item.alertType, "预警")}-${sanitizeModelInputText(item.content, "内容待确认")}-${sanitizeModelInputText(item.status, "状态待确认")}`).join("; "), "暂无有效预警信息")}`
    ].join("\n");

    const prompt = `${fillTemplate(template.template, { studentData })}\n\n输出规范:\n${template.outputSpec}`;

    initSse(res);
    sendSse(res, "conversation", { studentId, model: parsed.data.model });

    try {
        const result = await streamZhipu(
            {
                apiKey: parsed.data.apiKey,
                model: parsed.data.model,
                prompt,
                systemPrompt: template.systemPrompt,
                responseFormat: template.outputFormat,
                enableThinking: modelMeta.thinking
            },
            {
                onTextDelta: (delta) => sendSse(res, "delta", { delta }),
                onReasoningDelta: (delta) => sendSse(res, "reasoning-delta", { delta }),
                onUsage: (usage) => sendSse(res, "usage", usage)
            }
        );

        logAudit({
            userId: req.user.id,
            actionModule: "growth",
            actionType: "ai_diagnosis_stream",
            objectType: "student",
            objectId: studentId,
            detail: { model: parsed.data.model },
            ipAddress: extractIp(req)
        });

        sendSse(res, "complete", {
            studentId,
            answer: result.content,
            reasoning: result.reasoning,
            model: parsed.data.model,
            usage: result.usage,
            finishReason: result.finishReason
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : "未知错误";
        sendSse(res, "error", { message: `模型调用失败: ${reason}` });
    } finally {
        if (!res.writableEnded) {
            res.end();
        }
    }
});
