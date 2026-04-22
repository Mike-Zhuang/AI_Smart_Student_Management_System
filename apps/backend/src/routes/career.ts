import { Router, type Response } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { fillTemplate, getTemplateById } from "../config/promptTemplates.js";
import { DEFAULT_MODEL_ID, getSupportedModelById } from "../constants.js";
import { db } from "../db.js";
import { canAccessStudent, requireAuth } from "../middleware/auth.js";
import { callZhipu, streamZhipu } from "../services/zhipu.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";
import { getAllAllowedCombinations, isValidCombination, validateSelectionByStage } from "../utils/subjectRules.js";
import { normalizeExamName, repairText } from "../utils/text.js";

const generateSchema = z.object({
    studentId: z.number().int().positive(),
    model: z.string().min(3).default(DEFAULT_MODEL_ID),
    apiKey: z.string().min(10),
    supplementalContext: z.string().optional()
});

const combinations = getAllAllowedCombinations();

export const careerRouter = Router();

const parseJsonAnswer = (answer: string): Record<string, unknown> | null => {
    const trimmed = answer.trim();
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
    const source = fenced ? fenced[1].trim() : trimmed;

    try {
        return JSON.parse(source) as Record<string, unknown>;
    } catch {
        return null;
    }
};

const loadStudentContext = (studentId: number) => {
    const student = db
        .prepare(
            `SELECT id, name, grade, class_name as className,
                    academic_stage as academicStage,
                    subject_selection_status as selectionStatus,
                    first_selected_subject as firstSelectedSubject,
                    second_selected_subject as secondSelectedSubject,
                    third_selected_subject as thirdSelectedSubject,
                    subject_combination as subjectCombination,
                    interests, career_goal as careerGoal
             FROM students
             WHERE id = ?`
        )
        .get(studentId) as
        | {
            id: number;
            name: string;
            grade: string;
            className: string;
            academicStage: string | null;
            selectionStatus: string | null;
            firstSelectedSubject: string | null;
            secondSelectedSubject: string | null;
            thirdSelectedSubject: string | null;
            subjectCombination: string | null;
            interests: string | null;
            careerGoal: string | null;
        }
        | undefined;

    if (!student) {
        return null;
    }

    const scoreRows = db
        .prepare(
            `SELECT subject, exam_name as examName, exam_date as examDate, AVG(score) as avgScore
             FROM exam_results
             WHERE student_id = ?
             GROUP BY subject, exam_name, exam_date
             ORDER BY exam_date ASC`
        )
        .all(studentId) as Array<{ subject: string; examName: string; examDate: string; avgScore: number }>;

    return { student, scoreRows };
};

const buildStudentData = (
    student: NonNullable<ReturnType<typeof loadStudentContext>>["student"],
    scoreRows: NonNullable<ReturnType<typeof loadStudentContext>>["scoreRows"],
    supplementalContext?: string
) => {
    const latestFiveExams = Array.from(
        scoreRows.reduce((map, row) => {
            const key = `${row.examDate}-${row.examName}`;
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key)?.push(row);
            return map;
        }, new Map<string, Array<{ subject: string; examName: string; examDate: string; avgScore: number }>>())
    )
        .slice(-5)
        .map(([, rows]) => `${normalizeExamName(rows[0]?.examName) || rows[0]?.examName}：${rows.map((row) => `${row.subject}${Number(row.avgScore).toFixed(1)}`).join("，")}`)
        .join("\n");

    const averageBySubject = new Map<string, number>();
    scoreRows.forEach((row) => {
        const current = averageBySubject.get(row.subject) ?? 0;
        const count = averageBySubject.get(`${row.subject}_count`) ?? 0;
        averageBySubject.set(row.subject, current + row.avgScore);
        averageBySubject.set(`${row.subject}_count`, count + 1);
    });

    const subjectAverages = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "政治", "地理"]
        .map((subject) => {
            const total = averageBySubject.get(subject) ?? 0;
            const count = averageBySubject.get(`${subject}_count`) ?? 0;
            return `${subject}: ${count > 0 ? (total / count).toFixed(1) : "暂无"}`;
        })
        .join("\n");

    return [
        `姓名: ${student.name}`,
        `年级班级: ${student.grade} ${student.className}`,
        `当前学段: ${student.academicStage ?? "未知"}`,
        `当前选科状态: ${student.selectionStatus ?? "待完善"}`,
        `当前选科组合: ${student.subjectCombination ?? "暂无"}`,
        `兴趣方向: ${student.interests ?? "暂无"}`,
        `生涯目标: ${student.careerGoal ?? "暂无"}`,
        "历次考试摘要:",
        latestFiveExams || "暂无成绩",
        "学科平均分:",
        subjectAverages,
        `自由补充信息: ${repairText(supplementalContext ?? "") || "暂无"}`
    ].join("\n");
};

const persistRecommendation = (studentId: number, model: string, parsedAnswer: Record<string, unknown>, fallbackCombination: string | null) => {
    const dimensionScores = (parsedAnswer.dimensionScores ?? {}) as Record<string, number>;
    const aiCombination = typeof parsedAnswer.selectedCombination === "string" ? parsedAnswer.selectedCombination.trim() : "";
    const selectedCombination = isValidCombination(aiCombination)
        ? aiCombination
        : fallbackCombination && isValidCombination(fallbackCombination)
            ? fallbackCombination
            : combinations[0];

    const majorSuggestionsFromAi = Array.isArray(parsedAnswer.majorSuggestions)
        ? (parsedAnswer.majorSuggestions.filter((item) => typeof item === "string") as string[])
        : [];

    const majors = majorSuggestionsFromAi.length > 0
        ? majorSuggestionsFromAi
        : (db
            .prepare(
                `SELECT major
                 FROM public_major_requirements
                 WHERE required_subjects LIKE ?
                 ORDER BY reference_score DESC
                 LIMIT 5`
            )
            .all(`%${selectedCombination.split("+")[0]}%`) as Array<{ major: string }>).map((item) => item.major);

    const reasoning = typeof parsedAnswer.summary === "string" && parsedAnswer.summary.length > 0
        ? parsedAnswer.summary
        : "模型已完成分析，请结合成绩、兴趣与班主任建议综合判断。";

    const evidenceChain = Array.isArray(parsedAnswer.evidenceChain) ? parsedAnswer.evidenceChain : [];
    const counterfactual = typeof parsedAnswer.counterfactual === "string" ? parsedAnswer.counterfactual : "暂无";
    const confidence = typeof parsedAnswer.confidence === "number" ? parsedAnswer.confidence : 70;

    const scoreBreakdown = {
        science: Number(dimensionScores.science ?? 0),
        social: Number(dimensionScores.social ?? 0),
        logic: Number(dimensionScores.logic ?? 0),
        language: Number(dimensionScores.language ?? 0),
        stability: Number(dimensionScores.stability ?? 0),
        evidenceChain,
        counterfactual,
        confidence
    };

    db.prepare(
        `INSERT INTO career_recommendations (student_id, model, selected_combination, reasoning, major_suggestions, score_breakdown, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(studentId, model, selectedCombination, reasoning, majors.join(","), JSON.stringify(scoreBreakdown), dayjs().toISOString());

    return {
        selectedCombination,
        reasoning,
        majorSuggestions: majors,
        scoreBreakdown,
        counterfactual,
        confidence
    };
};

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

careerRouter.get("/public-data/major-requirements", requireAuth, (_req, res) => {
    const rows = db
        .prepare(
            `SELECT year, region, university, major, required_subjects as requiredSubjects, reference_score as referenceScore
             FROM public_major_requirements
             ORDER BY reference_score DESC`
        )
        .all();
    res.json({ success: true, message: "查询成功", data: rows });
});

careerRouter.get("/recommendations/:studentId", requireAuth, (req: AuthedRequest, res) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId) || !canAccessStudent(req, studentId)) {
        res.status(403).json({ success: false, message: "无权查看该学生选科建议" });
        return;
    }

    const rows = db
        .prepare(
            `SELECT id, model, selected_combination as selectedCombination, reasoning, major_suggestions as majorSuggestions,
                    score_breakdown as scoreBreakdown, created_at as createdAt
             FROM career_recommendations
             WHERE student_id = ?
             ORDER BY created_at DESC`
        )
        .all(studentId);

    res.json({ success: true, message: "查询成功", data: rows });
});

careerRouter.post("/recommendations/generate", requireAuth, async (req: AuthedRequest, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法，需提供有效 API Key" });
        return;
    }

    const input = parsed.data;
    if (!canAccessStudent(req, input.studentId)) {
        res.status(403).json({ success: false, message: "无权为该学生生成选科建议" });
        return;
    }

    const context = loadStudentContext(input.studentId);
    if (!context) {
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }
    if (context.scoreRows.length === 0) {
        res.status(404).json({ success: false, message: "未找到该学生成绩数据" });
        return;
    }

    const template = getTemplateById("career-structured-v1");
    const modelMeta = getSupportedModelById(input.model);
    if (!template || !modelMeta) {
        res.status(400).json({ success: false, message: "模板或模型不可用" });
        return;
    }

    const prompt = `${fillTemplate(template.template, {
        studentData: buildStudentData(context.student, context.scoreRows, input.supplementalContext)
    })}\n\n输出规范:\n${template.outputSpec}`;

    try {
        const result = await callZhipu({
            apiKey: input.apiKey,
            model: modelMeta.id,
            prompt,
            systemPrompt: template.systemPrompt,
            responseFormat: template.outputFormat,
            enableThinking: modelMeta.thinking
        });

        const parsedAnswer = parseJsonAnswer(result.content);
        if (!parsedAnswer) {
            res.status(502).json({ success: false, message: "模型返回格式异常，请重试（需返回合法 JSON）" });
            return;
        }

        const validated = validateSelectionByStage({
            stage: (context.student.academicStage === "高一上" || context.student.academicStage === "高一下" || context.student.academicStage === "高二" || context.student.academicStage === "高三")
                ? context.student.academicStage
                : "高一下",
            firstSelectedSubject: context.student.firstSelectedSubject,
            secondSelectedSubject: context.student.secondSelectedSubject,
            thirdSelectedSubject: context.student.thirdSelectedSubject
        });
        const persisted = persistRecommendation(
            input.studentId,
            modelMeta.id,
            parsedAnswer,
            validated.ok ? validated.subjectCombination : context.student.subjectCombination
        );

        logAudit({
            userId: req.user.id,
            actionModule: "career",
            actionType: "recommendation_generate",
            objectType: "career_recommendation",
            detail: {
                studentId: input.studentId,
                model: modelMeta.id,
                supplementalContextLength: (input.supplementalContext ?? "").length,
                selectedCombination: persisted.selectedCombination
            },
            ipAddress: extractIp(req)
        });

        res.json({ success: true, message: "生成成功", data: persisted });
    } catch (error) {
        const reason = error instanceof Error ? error.message : "未知错误";
        res.status(502).json({ success: false, message: `模型调用失败: ${reason}` });
    }
});

careerRouter.post("/recommendations/generate-stream", requireAuth, async (req: AuthedRequest, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法，需提供有效 API Key" });
        return;
    }

    const input = parsed.data;
    if (!canAccessStudent(req, input.studentId)) {
        res.status(403).json({ success: false, message: "无权为该学生生成选科建议" });
        return;
    }

    const context = loadStudentContext(input.studentId);
    if (!context) {
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }
    if (context.scoreRows.length === 0) {
        res.status(404).json({ success: false, message: "未找到该学生成绩数据" });
        return;
    }

    const template = getTemplateById("career-structured-v1");
    const modelMeta = getSupportedModelById(input.model);
    if (!template || !modelMeta) {
        res.status(400).json({ success: false, message: "模板或模型不可用" });
        return;
    }

    const prompt = `${fillTemplate(template.template, {
        studentData: buildStudentData(context.student, context.scoreRows, input.supplementalContext)
    })}\n\n输出规范:\n${template.outputSpec}`;

    initSse(res);
    sendSse(res, "conversation", { studentId: input.studentId, model: modelMeta.id });

    let answer = "";
    let reasoning = "";
    req.on("close", () => {
        if (!res.writableEnded) {
            res.end();
        }
    });

    try {
        const result = await streamZhipu(
            {
                apiKey: input.apiKey,
                model: modelMeta.id,
                prompt,
                systemPrompt: template.systemPrompt,
                responseFormat: template.outputFormat,
                enableThinking: modelMeta.thinking
            },
            {
                onTextDelta: (delta) => {
                    answer += delta;
                    sendSse(res, "delta", { delta });
                },
                onReasoningDelta: (delta) => {
                    reasoning += delta;
                    sendSse(res, "reasoning-delta", { delta });
                }
            }
        );

        answer = result.content;
        reasoning = result.reasoning ?? reasoning;

        const parsedAnswer = parseJsonAnswer(answer);
        if (!parsedAnswer) {
            sendSse(res, "error", { message: "模型返回格式异常，请重试（需返回合法 JSON）" });
            res.end();
            return;
        }

        const validated = validateSelectionByStage({
            stage: (context.student.academicStage === "高一上" || context.student.academicStage === "高一下" || context.student.academicStage === "高二" || context.student.academicStage === "高三")
                ? context.student.academicStage
                : "高一下",
            firstSelectedSubject: context.student.firstSelectedSubject,
            secondSelectedSubject: context.student.secondSelectedSubject,
            thirdSelectedSubject: context.student.thirdSelectedSubject
        });
        const persisted = persistRecommendation(
            input.studentId,
            modelMeta.id,
            parsedAnswer,
            validated.ok ? validated.subjectCombination : context.student.subjectCombination
        );

        logAudit({
            userId: req.user.id,
            actionModule: "career",
            actionType: "recommendation_generate_stream",
            objectType: "career_recommendation",
            detail: {
                studentId: input.studentId,
                model: modelMeta.id,
                supplementalContextLength: (input.supplementalContext ?? "").length,
                selectedCombination: persisted.selectedCombination
            },
            ipAddress: extractIp(req)
        });

        sendSse(res, "complete", {
            answer,
            reasoning,
            studentId: input.studentId,
            model: modelMeta.id,
            result: persisted
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : "未知错误";
        sendSse(res, "error", { message: `模型调用失败: ${reason}` });
    } finally {
        res.end();
    }
});
