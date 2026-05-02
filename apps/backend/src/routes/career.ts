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
import { parseStructuredJson } from "../utils/structuredOutput.js";
import { getAllAllowedCombinations, isValidCombination, validateSelectionByStage } from "../utils/subjectRules.js";
import { normalizeExamName, repairText, sanitizeModelInputText } from "../utils/text.js";

const generateSchema = z.object({
    studentId: z.number().int().positive(),
    model: z.string().min(3).default(DEFAULT_MODEL_ID),
    apiKey: z.string().min(10),
    supplementalContext: z.string().optional()
});

const majorRecommendationQuerySchema = z.object({
    studentId: z.coerce.number().int().positive(),
    examMode: z.enum(["latest", "specific", "recent3Weighted", "trendFit"]).default("recent3Weighted"),
    scoreMode: z.enum(["gaokaoSixSubjectScale", "allSubjectScale", "rawTotal", "manual"]).default("gaokaoSixSubjectScale"),
    examKey: z.string().optional(),
    manualScore: z.coerce.number().min(0).max(750).optional(),
    keyword: z.string().optional(),
    matchLevel: z.enum(["all", "reach", "match", "safe"]).default("all")
});

const combinations = getAllAllowedCombinations();
const CORE_SUBJECTS = ["语文", "数学", "英语"];

export const careerRouter = Router();

const parseJsonAnswer = (answer: string) => parseStructuredJson(answer);

const normalizeRecommendationPayload = (raw: Record<string, unknown>): Record<string, unknown> => {
    const normalized = { ...raw };

    if (typeof normalized.summary !== "string" && typeof normalized.reasoning === "string") {
        normalized.summary = normalized.reasoning;
    }

    if (!Array.isArray(normalized.majorSuggestions) && typeof normalized.majorSuggestions === "string") {
        normalized.majorSuggestions = String(normalized.majorSuggestions)
            .split(/[、,，；;]+/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    }

    if (typeof normalized.confidence === "string") {
        const parsed = Number(normalized.confidence);
        if (!Number.isNaN(parsed)) {
            normalized.confidence = parsed;
        }
    }

    return normalized;
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

const toFriendlyRecommendationText = (result: {
    selectedCombination: string;
    reasoning: string;
    majorSuggestions: string[];
    scoreBreakdown: {
        science: number;
        social: number;
        logic: number;
        language: number;
        stability: number;
        confidence?: number;
        counterfactual?: string;
    };
}): string => {
    const suggestions = result.majorSuggestions.slice(0, 3).join("、") || "暂无";
    return [
        `推荐组合：${result.selectedCombination}`,
        `综合判断：${result.reasoning}`,
        `重点维度：逻辑 ${result.scoreBreakdown.logic} / 科学 ${result.scoreBreakdown.science} / 稳定性 ${result.scoreBreakdown.stability}`,
        `专业方向：${suggestions}`,
        `置信度：${result.scoreBreakdown.confidence ?? "--"}`
    ].join("\n");
};

const splitTextForStreaming = (value: string): string[] => {
    return value
        .split(/(?<=[。；！\n])/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
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
        .map(([, rows]) => `${normalizeExamName(rows[0]?.examName) || sanitizeModelInputText(rows[0]?.examName ?? "", "考试")}：${rows.map((row) => `${sanitizeModelInputText(row.subject, "学科")}${Number(row.avgScore).toFixed(1)}`).join("，")}`)
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
            return `${sanitizeModelInputText(subject, "学科")}: ${count > 0 ? (total / count).toFixed(1) : "暂无"}`;
        })
        .join("\n");

    return [
        `姓名: ${sanitizeModelInputText(student.name, "暂无有效姓名")}`,
        `年级班级: ${sanitizeModelInputText(student.grade, "未知年级")} ${sanitizeModelInputText(student.className, "未知班级")}`,
        `当前学段: ${sanitizeModelInputText(student.academicStage ?? "", "未知")}`,
        `当前选科状态: ${sanitizeModelInputText(student.selectionStatus ?? "", "待完善")}`,
        `当前选科组合: ${sanitizeModelInputText(student.subjectCombination ?? "", "暂无")}`,
        `兴趣方向: ${sanitizeModelInputText(student.interests ?? "", "暂无有效兴趣信息")}`,
        `生涯目标: ${sanitizeModelInputText(student.careerGoal ?? "", "暂无有效目标信息")}`,
        "历次考试摘要:",
        sanitizeModelInputText(latestFiveExams, "暂无有效成绩摘要"),
        "学科平均分:",
        sanitizeModelInputText(subjectAverages, "暂无有效学科均分信息"),
        `自由补充信息: ${sanitizeModelInputText(supplementalContext ?? "", "暂无有效补充信息")}`
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

type ExamGroup = {
    key: string;
    examName: string;
    examDate: string;
    rows: Array<{ subject: string; avgScore: number }>;
};

const buildExamGroups = (scoreRows: NonNullable<ReturnType<typeof loadStudentContext>>["scoreRows"]): ExamGroup[] => {
    const grouped = new Map<string, ExamGroup>();
    scoreRows.forEach((row) => {
        const examName = normalizeExamName(row.examName) || repairText(row.examName);
        const key = `${row.examDate}__${examName}`;
        const existing = grouped.get(key) ?? { key, examName, examDate: row.examDate, rows: [] };
        existing.rows.push({ subject: repairText(row.subject), avgScore: Number(row.avgScore) });
        grouped.set(key, existing);
    });
    return Array.from(grouped.values()).sort((left, right) => left.examDate.localeCompare(right.examDate));
};

const getStudentSelectedSubjects = (student: NonNullable<ReturnType<typeof loadStudentContext>>["student"], exam: ExamGroup): string[] => {
    const explicitSubjects = [student.firstSelectedSubject, student.secondSelectedSubject, student.thirdSelectedSubject]
        .map((item) => repairText(item ?? ""))
        .filter(Boolean);
    const combinationSubjects = repairText(student.subjectCombination ?? "")
        .split("+")
        .map((item) => item.trim())
        .filter(Boolean);
    const selected = [...new Set([...explicitSubjects, ...combinationSubjects])].filter((item) => !CORE_SUBJECTS.includes(item));
    if (selected.length >= 3) {
        return selected.slice(0, 3);
    }

    const fallbackSubjects = exam.rows
        .filter((row) => !CORE_SUBJECTS.includes(row.subject))
        .sort((left, right) => right.avgScore - left.avgScore)
        .map((row) => row.subject);
    return [...new Set([...selected, ...fallbackSubjects])].slice(0, 3);
};

const sumSubjects = (exam: ExamGroup, subjects: string[]): { rawScore: number; maxScore: number; subjects: string[] } => {
    const subjectMap = new Map(exam.rows.map((row) => [row.subject, row.avgScore]));
    const usedSubjects = subjects.filter((subject) => subjectMap.has(subject));
    const rawScore = usedSubjects.reduce((total, subject) => total + (subjectMap.get(subject) ?? 0), 0);
    return { rawScore, maxScore: usedSubjects.length * 100, subjects: usedSubjects };
};

const calcExamScore = (
    exam: ExamGroup,
    student: NonNullable<ReturnType<typeof loadStudentContext>>["student"],
    scoreMode: z.infer<typeof majorRecommendationQuerySchema>["scoreMode"],
    manualScore?: number
): { rawScore: number; scaledScore: number; subjects: string[]; method: string } => {
    if (scoreMode === "manual") {
        const score = Number(manualScore ?? 0);
        return { rawScore: score, scaledScore: score, subjects: [], method: "手动输入分数，直接用于录取分差匹配。" };
    }

    if (scoreMode === "allSubjectScale") {
        const rawScore = exam.rows.reduce((total, row) => total + row.avgScore, 0);
        const maxScore = Math.max(exam.rows.length * 100, 1);
        return {
            rawScore,
            scaledScore: Number(((rawScore / maxScore) * 750).toFixed(1)),
            subjects: exam.rows.map((row) => row.subject),
            method: "全科均分折算：最近考试参与科目总分 / 科目满分 × 750。"
        };
    }

    if (scoreMode === "rawTotal") {
        const rawScore = exam.rows.reduce((total, row) => total + row.avgScore, 0);
        return {
            rawScore: Number(rawScore.toFixed(1)),
            scaledScore: Number(rawScore.toFixed(1)),
            subjects: exam.rows.map((row) => row.subject),
            method: "原始总分：直接使用该次考试已导入科目总分，不做 750 分折算。"
        };
    }

    const selectedSubjects = [...CORE_SUBJECTS, ...getStudentSelectedSubjects(student, exam)];
    const result = sumSubjects(exam, selectedSubjects);
    return {
        rawScore: Number(result.rawScore.toFixed(1)),
        scaledScore: Number(((result.rawScore / Math.max(result.maxScore, 1)) * 750).toFixed(1)),
        subjects: result.subjects,
        method: "六科折算：语文、数学、英语加当前选科三科；缺少明确选科时，用非核心科目中较高的三科临时补足，并按 750 分折算。"
    };
};

const pickScoreProfile = (
    groups: ExamGroup[],
    student: NonNullable<ReturnType<typeof loadStudentContext>>["student"],
    query: z.infer<typeof majorRecommendationQuerySchema>
) => {
    const ordered = [...groups].sort((left, right) => left.examDate.localeCompare(right.examDate));
    const latest = ordered.at(-1);
    if (!latest) {
        return null;
    }

    const calcOne = (exam: ExamGroup) => calcExamScore(exam, student, query.scoreMode, query.manualScore);
    const examOptions = ordered.map((exam) => ({ key: exam.key, examName: exam.examName, examDate: exam.examDate }));

    if (query.scoreMode === "manual") {
        const score = calcOne(latest);
        return {
            examKey: "manual",
            examName: "手动输入",
            examDate: latest.examDate,
            rawScore: score.rawScore,
            scaledScore: score.scaledScore,
            subjects: score.subjects,
            method: score.method,
            examOptions
        };
    }

    if (query.examMode === "specific") {
        const target = ordered.find((exam) => exam.key === query.examKey) ?? latest;
        const score = calcOne(target);
        return { examKey: target.key, examName: target.examName, examDate: target.examDate, ...score, examOptions };
    }

    if (query.examMode === "latest") {
        const score = calcOne(latest);
        return { examKey: latest.key, examName: latest.examName, examDate: latest.examDate, ...score, examOptions };
    }

    const recent = ordered.slice(-3);
    const scored = recent.map((exam) => ({ exam, score: calcOne(exam).scaledScore }));
    if (query.examMode === "trendFit" && scored.length >= 2) {
        const weights = scored.map((_, index) => index + 1);
        const weightTotal = weights.reduce((sum, item) => sum + item, 0);
        const weightedAverage = scored.reduce((sum, item, index) => sum + item.score * weights[index], 0) / weightTotal;
        const first = scored[0].score;
        const last = scored.at(-1)?.score ?? first;
        const slopeCorrection = Math.max(-25, Math.min(25, (last - first) / Math.max(scored.length - 1, 1)));
        return {
            examKey: "trendFit",
            examName: `趋势拟合（近 ${scored.length} 次）`,
            examDate: latest.examDate,
            rawScore: Number(weightedAverage.toFixed(1)),
            scaledScore: Number(Math.max(0, Math.min(750, weightedAverage + slopeCorrection)).toFixed(1)),
            subjects: calcOne(latest).subjects,
            method: "时间衰减加权线性趋势：越新的考试权重越高，先计算加权均值，再用首末成绩趋势做斜率修正，单次修正限制在 ±25 分。",
            examOptions
        };
    }

    const weights = recent.map((_, index) => index + 1);
    const weightTotal = weights.reduce((sum, item) => sum + item, 0);
    const weighted = recent.reduce((sum, exam, index) => sum + calcOne(exam).scaledScore * weights[index], 0) / weightTotal;
    return {
        examKey: "recent3Weighted",
        examName: `最近 ${recent.length} 次加权`,
        examDate: latest.examDate,
        rawScore: Number(weighted.toFixed(1)),
        scaledScore: Number(weighted.toFixed(1)),
        subjects: calcOne(latest).subjects,
        method: "最近三次时间衰减加权：按 1:2:3 给予近期考试更高权重，降低单次考试偶然波动影响。",
        examOptions
    };
};

const matchesRequiredSubjects = (requiredSubjects: string, selectedSubjects: string[]): boolean => {
    const normalized = repairText(requiredSubjects);
    const limitedPart = normalized.replace(/不限/g, "").trim();
    if (!limitedPart) {
        return true;
    }
    if (limitedPart.includes("或")) {
        return limitedPart.split("或").some((item) => selectedSubjects.includes(item.trim()));
    }
    return limitedPart.split("+").every((item) => {
        const subject = item.replace("不限", "").trim();
        return !subject || selectedSubjects.includes(subject);
    });
};

const classifyScoreGap = (gap: number): "reach" | "match" | "safe" => {
    if (gap < -15) {
        return "reach";
    }
    if (gap <= 25) {
        return "match";
    }
    return "safe";
};

const matchLevelLabelMap = {
    reach: "冲刺",
    match: "匹配",
    safe: "保底"
} as const;

const buildMajorRecommendations = (
    scoreProfile: NonNullable<ReturnType<typeof pickScoreProfile>>,
    selectedSubjects: string[],
    keyword: string,
    matchLevel: "all" | "reach" | "match" | "safe"
) => {
    const rows = db
        .prepare(
            `SELECT year, region, university, major, required_subjects as requiredSubjects, reference_score as referenceScore
             FROM public_major_requirements
             ORDER BY year DESC, reference_score DESC`
        )
        .all() as Array<{ year: number; region: string; university: string; major: string; requiredSubjects: string; referenceScore: number }>;

    const grouped = new Map<string, typeof rows>();
    rows.forEach((row) => {
        const key = `${repairText(row.university)}__${repairText(row.major)}`;
        const current = grouped.get(key) ?? [];
        current.push(row);
        grouped.set(key, current);
    });

    return Array.from(grouped.values())
        .map((items) => {
            const sorted = [...items].sort((left, right) => right.year - left.year);
            const latest = sorted[0];
            const admissionScores = sorted.slice(0, 3).map((item) => ({ year: item.year, score: item.referenceScore, region: repairText(item.region) }));
            const scores = admissionScores.map((item) => item.score);
            const averageScore = Number((scores.reduce((sum, score) => sum + score, 0) / Math.max(scores.length, 1)).toFixed(1));
            const scoreGap = Number((scoreProfile.scaledScore - averageScore).toFixed(1));
            const level = classifyScoreGap(scoreGap);
            return {
                university: repairText(latest.university),
                major: repairText(latest.major),
                requiredSubjects: repairText(latest.requiredSubjects),
                matchLevel: level,
                matchLevelLabel: matchLevelLabelMap[level],
                subjectMatched: matchesRequiredSubjects(latest.requiredSubjects, selectedSubjects),
                scoreGap,
                admissionScores,
                averageScore,
                minScore: Math.min(...scores),
                maxScore: Math.max(...scores),
                historyComplete: admissionScores.length >= 3
            };
        })
        .filter((item) => matchLevel === "all" || item.matchLevel === matchLevel)
        .filter((item) => {
            const normalizedKeyword = keyword.trim().toLowerCase();
            if (!normalizedKeyword) {
                return true;
            }
            return `${item.university}${item.major}${item.requiredSubjects}`.toLowerCase().includes(normalizedKeyword);
        })
        .sort((left, right) => {
            if (left.subjectMatched !== right.subjectMatched) {
                return left.subjectMatched ? -1 : 1;
            }
            return Math.abs(left.scoreGap) - Math.abs(right.scoreGap);
        })
        .slice(0, 40);
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

careerRouter.get("/major-recommendations", requireAuth, (req: AuthedRequest, res) => {
    const parsed = majorRecommendationQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "院校推荐查询参数不合法" });
        return;
    }

    const input = parsed.data;
    if (input.scoreMode === "manual" && typeof input.manualScore !== "number") {
        res.status(400).json({ success: false, message: "手动分数模式需要输入有效分数" });
        return;
    }

    if (!canAccessStudent(req, input.studentId)) {
        res.status(403).json({ success: false, message: "无权查看该学生院校推荐" });
        return;
    }

    const context = loadStudentContext(input.studentId);
    if (!context) {
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }

    const groups = buildExamGroups(context.scoreRows);
    const scoreProfile = pickScoreProfile(groups, context.student, input);
    if (!scoreProfile) {
        res.status(404).json({ success: false, message: "未找到该学生成绩数据" });
        return;
    }

    const selectedSubjects = [...CORE_SUBJECTS, ...getStudentSelectedSubjects(context.student, groups.at(-1) ?? groups[0])];
    const recommendations = buildMajorRecommendations(scoreProfile, selectedSubjects, repairText(input.keyword ?? ""), input.matchLevel);

    res.json({
        success: true,
        message: "查询成功",
        data: {
            scoreProfile: {
                ...scoreProfile,
                scoreMode: input.scoreMode,
                examMode: input.examMode,
                selectedSubjects
            },
            recommendations,
            filters: {
                exams: scoreProfile.examOptions,
                years: [...new Set(recommendations.flatMap((item) => item.admissionScores.map((score) => score.year)))].sort((left, right) => right - left),
                matchLevels: [
                    { value: "all", label: "全部" },
                    { value: "reach", label: "冲刺" },
                    { value: "match", label: "匹配" },
                    { value: "safe", label: "保底" }
                ]
            }
        }
    });
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
            enableThinking: modelMeta.thinking,
            maxOutputTokens: 12288
        });

        const parsedAnswer = parseJsonAnswer(result.content);
        if (!parsedAnswer.parsed) {
            res.status(502).json({ success: false, message: parsedAnswer.error ?? "模型返回格式异常，请重试（需返回合法 JSON）" });
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
            normalizeRecommendationPayload(parsedAnswer.parsed),
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
    let stageHintsSent = 0;
    let clientClosed = false;
    res.on("close", () => {
        clientClosed = true;
    });

    const emitHint = (hint: string): void => {
        if (clientClosed || res.writableEnded) {
            return;
        }
        sendSse(res, "delta", { delta: hint });
    };

    try {
        emitHint("正在分析学生成绩、兴趣方向与生涯目标…\n");
        stageHintsSent = 1;
        const result = await streamZhipu(
            {
                apiKey: input.apiKey,
                model: modelMeta.id,
                prompt,
                systemPrompt: template.systemPrompt,
                responseFormat: template.outputFormat,
                enableThinking: modelMeta.thinking,
                maxOutputTokens: 12288
            },
            {
                onTextDelta: (delta) => {
                    if (clientClosed || res.writableEnded) {
                        return;
                    }
                    answer += delta;
                    if (stageHintsSent < 2 && delta.trim().length > 0) {
                        emitHint("正在匹配选科组合并整理证据链…\n");
                        stageHintsSent = 2;
                    }
                },
                onReasoningDelta: (delta) => {
                    if (clientClosed || res.writableEnded) {
                        return;
                    }
                    reasoning += delta;
                    sendSse(res, "reasoning-delta", { delta });
                    if (stageHintsSent < 2 && reasoning.length > 30) {
                        emitHint("正在结合成绩趋势、兴趣方向和家校补充信息综合判断…\n");
                        stageHintsSent = 2;
                    }
                },
                onUsage: (usage) => {
                    if (clientClosed || res.writableEnded) {
                        return;
                    }
                    sendSse(res, "usage", usage);
                }
            }
        );

        answer = result.content;
        reasoning = result.reasoning ?? reasoning;
        if (stageHintsSent < 3) {
            emitHint("正在校验结构化结果并整理最终建议…\n");
            stageHintsSent = 3;
        }

        const parsedAnswer = parseJsonAnswer(answer);
        if (!parsedAnswer.parsed) {
            const finishReasonType = result.finishReason === "length" ? "TRUNCATED_OUTPUT" : parsedAnswer.errorType ?? "INVALID_JSON";
            const errorMessage =
                finishReasonType === "TRUNCATED_OUTPUT"
                    ? "模型输出被截断，未能整理成完整选科建议，请重试或切换更稳定模型。"
                    : finishReasonType === "EMPTY_FINAL_CONTENT"
                        ? "模型没有返回最终正文，请重试。"
                        : "模型返回了不完整的结构化内容，请重试。";
            sendSse(res, "error", { type: finishReasonType, message: errorMessage });
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
            normalizeRecommendationPayload(parsedAnswer.parsed),
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
            answer: toFriendlyRecommendationText(persisted),
            reasoning,
            studentId: input.studentId,
            model: modelMeta.id,
            result: persisted,
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
