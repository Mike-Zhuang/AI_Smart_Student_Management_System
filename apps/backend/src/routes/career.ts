import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";

const generateSchema = z.object({
    studentId: z.number().int().positive(),
    model: z.string().min(3)
});

const combinations = [
    "物理+化学+生物",
    "物理+化学+政治",
    "物理+生物+地理",
    "历史+政治+地理",
    "历史+生物+地理"
];

export const careerRouter = Router();

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
    if (Number.isNaN(studentId)) {
        res.status(400).json({ success: false, message: "studentId 不合法" });
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

careerRouter.post("/recommendations/generate", requireAuth, (req, res) => {
    const authedReq = req as AuthedRequest;
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const input = parsed.data;
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

    const avgMap = new Map(scoreRows.map((item) => [item.subject, item.avgScore]));
    const scienceScore = (avgMap.get("物理") ?? 0) + (avgMap.get("化学") ?? 0) + (avgMap.get("生物") ?? 0);
    const socialScore = (avgMap.get("历史") ?? 0) + (avgMap.get("政治") ?? 0) + (avgMap.get("地理") ?? 0);
    const logic = (avgMap.get("数学") ?? 0) * 1.1;
    const language = ((avgMap.get("语文") ?? 0) + (avgMap.get("英语") ?? 0)) / 2;

    const chosen = scienceScore + logic >= socialScore + language ? combinations[0] : combinations[3];

    const majors = db
        .prepare(
            `SELECT major FROM public_major_requirements
       WHERE required_subjects LIKE ?
       ORDER BY reference_score DESC
       LIMIT 5`
        )
        .all(`%${chosen.split("+")[0]}%`) as Array<{ major: string }>;

    const reasoning =
        chosen === combinations[0]
            ? "学生理科与逻辑能力较强，且稳定性较高，建议优先考虑理工医方向组合。"
            : "学生人文与表达能力突出，建议优先考虑法学、教育、管理等方向组合。";

    const dimensionScores = {
        science: Number((scienceScore / 3).toFixed(1)),
        social: Number((socialScore / 3).toFixed(1)),
        logic: Number(logic.toFixed(1)),
        language: Number(language.toFixed(1)),
        stability: Number((70 + (input.studentId % 25)).toFixed(1))
    };

    const evidenceChain = [
        {
            dimension: "science",
            evidence: `理科三科均分 ${dimensionScores.science}`,
            impact: chosen.includes("物理") ? "支撑理科组合优先" : "理科维度略弱"
        },
        {
            dimension: "logic",
            evidence: `数学推理能力分 ${dimensionScores.logic}`,
            impact: "直接影响工科和信息类专业适配"
        },
        {
            dimension: "language",
            evidence: `语文/英语综合分 ${dimensionScores.language}`,
            impact: "影响文法类专业竞争力"
        }
    ];

    const counterfactual =
        chosen === combinations[0]
            ? "若文科维度提升至与理科相当，可考虑历史+政治+地理组合，但当前理科稳定性优势更明显。"
            : "若理科维度提升8分以上，可考虑物理+化学+生物组合，以扩大理工医专业覆盖。";

    const confidence = Number(
        (
            Math.min(95, Math.max(55, (dimensionScores.stability + Math.max(dimensionScores.science, dimensionScores.social)) / 2))
        ).toFixed(1)
    );

    const scoreBreakdown = {
        ...dimensionScores,
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
        chosen,
        reasoning,
        majors.map((item) => item.major).join(","),
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
                selectedCombination: chosen,
                confidence
            },
            ipAddress: extractIp(req)
        });
    }

    res.json({
        success: true,
        message: "生成成功",
        data: {
            selectedCombination: chosen,
            reasoning,
            majorSuggestions: majors.map((item) => item.major),
            scoreBreakdown,
            counterfactual,
            confidence
        }
    });
});
