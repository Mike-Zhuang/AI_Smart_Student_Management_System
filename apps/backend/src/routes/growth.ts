import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, canAccessStudent } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

export const growthRouter = Router();

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
    .get(studentId);

  const profile = db
    .prepare(
      `SELECT summary, risk_level as riskLevel, last_updated as lastUpdated
       FROM growth_profiles WHERE student_id = ?`
    )
    .get(studentId);

  res.json({ success: true, message: "查询成功", data: { student, profile } });
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
    examName: item.examName,
    avgScore: Number((item.total / item.count).toFixed(1))
  }));

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

  res.json({ success: true, message: "查询成功", data: rows });
});
