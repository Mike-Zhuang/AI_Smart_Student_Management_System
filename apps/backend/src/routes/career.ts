import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { fillTemplate, getTemplateById } from "../config/promptTemplates.js";
import { getSupportedModelById } from "../constants.js";
import { db } from "../db.js";
import { canAccessStudent, requireAuth } from "../middleware/auth.js";
import { callZhipu } from "../services/zhipu.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";
import {
    getAllAllowedCombinations,
    isValidCombination,
    validateSelectionByStage
} from "../utils/subjectRules.js";

const generateSchema = z.object({
    studentId: z.number().int().positive(),
    model: z.string().min(3),
    apiKey: z.string().min(10)
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
        res.status(403).json({ success: false, message: "无权查看该学生选科推荐" });
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

careerRouter.post("/recommendations/generate", requireAuth, async (req, res) => {
    const authedReq = req as AuthedRequest;
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success || !authedReq.user) {
        res.status(400).json({ success: false, message: "参数不合法，需提供有效 API Key" });
        return;
    }

    const input = parsed.data;
    if (!canAccessStudent(authedReq, input.studentId)) {
        res.status(403).json({ success: false, message: "无权为该学生生成选科推荐" });
        return;
    }

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
        .get(input.studentId) as
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
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }

    if (student.academicStage === "高一上") {
        res.status(400).json({ success: false, message: "高一上学段为九科学习阶段，暂不支持生成选科推荐" });
        return;
    }

    const scoreRows = db
        .prepare(
            `SELECT subject, AVG(score) as avgScore
       FROM exam_results
       WHERE student_id = ?
       GROUP BY subject`
        )
        .all(input.studentId) as Array<{ subject: string; avgScore: number }>;

    if (scoreRows.length === 0) {
        res.status(404).json({ success: false, message: "未找到该学生成绩数据" });
        return;
    }

    const template = getTemplateById("career-structured-v1");
    if (!template) {
        res.status(500).json({ success: false, message: "系统未找到生涯推荐模板" });
        return;
    }

    const avgMap = new Map(scoreRows.map((item) => [item.subject, item.avgScore]));
    const studentData = [
        `姓名: ${student.name}`,
        `年级班级: ${student.grade} ${student.className}`,
        `兴趣: ${student.interests ?? "暂无"}`,
        `生涯目标: ${student.careerGoal ?? "暂无"}`,
        `当前学段: ${student.academicStage ?? "未知"}`,
        `当前选课状态: ${student.selectionStatus ?? "未知"}`,
        `当前选课组合: ${student.subjectCombination ?? "暂无"}`,
        `语文: ${(avgMap.get("语文") ?? 0).toFixed(1)}`,
        `数学: ${(avgMap.get("数学") ?? 0).toFixed(1)}`,
        `英语: ${(avgMap.get("英语") ?? 0).toFixed(1)}`,
        `物理: ${(avgMap.get("物理") ?? 0).toFixed(1)}`,
        `化学: ${(avgMap.get("化学") ?? 0).toFixed(1)}`,
        `生物: ${(avgMap.get("生物") ?? 0).toFixed(1)}`,
        `历史: ${(avgMap.get("历史") ?? 0).toFixed(1)}`,
        `政治: ${(avgMap.get("政治") ?? 0).toFixed(1)}`,
        `地理: ${(avgMap.get("地理") ?? 0).toFixed(1)}`
    ].join("\n");

    const prompt = `${fillTemplate(template.template, { studentData })}\n\n输出规范:\n${template.outputSpec}`;

    const modelMeta = getSupportedModelById(input.model);
    if (!modelMeta) {
        res.status(400).json({ success: false, message: "不支持的模型" });
        return;
    }

    if (template.outputFormat === "json_object" && !modelMeta.supportsJsonMode) {
        res.status(400).json({ success: false, message: `模型 ${modelMeta.name} 不支持结构化输出` });
        return;
    }

    let answer = "";
    try {
        const result = await callZhipu({
            apiKey: input.apiKey,
            model: input.model,
            prompt,
            systemPrompt: template.systemPrompt,
            responseFormat: template.outputFormat,
            enableThinking: modelMeta.thinking
        });
        answer = result.content;
    } catch (error) {
        const reason = error instanceof Error ? error.message : "未知错误";
        res.status(502).json({ success: false, message: `模型调用失败: ${reason}` });
        return;
    }

    const parsedAnswer = parseJsonAnswer(answer);
    if (!parsedAnswer) {
        res.status(502).json({ success: false, message: "模型返回格式异常，请重试（需返回合法JSON）" });
        return;
    }

    const dimensionScores = (parsedAnswer.dimensionScores ?? {}) as Record<string, number>;
    const stageValidated = validateSelectionByStage({
        stage: (student.academicStage === "高一下" || student.academicStage === "高二" || student.academicStage === "高三" || student.academicStage === "高一上"
            ? student.academicStage
            : "高二"),
        firstSelectedSubject: student.firstSelectedSubject,
        secondSelectedSubject: student.secondSelectedSubject,
        thirdSelectedSubject: student.thirdSelectedSubject
    });

    const currentCombination =
        stageValidated.ok && stageValidated.subjectCombination
            ? stageValidated.subjectCombination
            : student.subjectCombination;

    const aiCombination = typeof parsedAnswer.selectedCombination === "string" ? parsedAnswer.selectedCombination.trim() : "";
    const selectedCombination = isValidCombination(aiCombination)
        ? aiCombination
        : currentCombination && isValidCombination(currentCombination)
            ? currentCombination
            : combinations[0];
    const majorSuggestionsFromAi = Array.isArray(parsedAnswer.majorSuggestions)
        ? parsedAnswer.majorSuggestions.filter((item) => typeof item === "string") as string[]
        : [];

    const majors = majorSuggestionsFromAi.length > 0
        ? majorSuggestionsFromAi
        : (db
            .prepare(
                `SELECT major FROM public_major_requirements
                 WHERE required_subjects LIKE ?
                 ORDER BY reference_score DESC
                 LIMIT 5`
            )
            .all(`%${selectedCombination.split("+")[0]}%`) as Array<{ major: string }>).map((item) => item.major);

    const reasoning = typeof parsedAnswer.summary === "string" && parsedAnswer.summary.length > 0
        ? parsedAnswer.summary
        : "模型已完成分析，请结合证据链进行人工复核。";

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
    ).run(
        input.studentId,
        input.model,
        selectedCombination,
        reasoning,
        majors.join(","),
        JSON.stringify(scoreBreakdown),
        dayjs().toISOString()
    );

    if (authedReq.user) {
        logAudit({
            userId: authedReq.user.id,
            actionModule: "career",
            actionType: "recommendation_generate",
            objectType: "career_recommendation",
            detail: {
                studentId: input.studentId,
                model: input.model,
                selectedCombination,
                ai: true,
                confidence
            },
            ipAddress: extractIp(req)
        });
    }

    res.json({
        success: true,
        message: "生成成功",
        data: {
            selectedCombination,
            reasoning,
            majorSuggestions: majors,
            scoreBreakdown,
            counterfactual,
            confidence
        }
    });
});
