import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const studentImportSchema = z.object({
  rows: z.array(
    z.object({
      studentNo: z.string().min(4),
      name: z.string().min(2),
      grade: z.string().min(2),
      className: z.string().min(2),
      subjectCombination: z.string().optional(),
      interests: z.string().optional(),
      careerGoal: z.string().optional()
    })
  )
});

const examImportSchema = z.object({
  rows: z.array(
    z.object({
      studentNo: z.string().min(4),
      examName: z.string().min(2),
      examDate: z.string().min(8),
      subject: z.string().min(2),
      score: z.number().min(0).max(100)
    })
  )
});

export const dataImportRouter = Router();

dataImportRouter.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.HEAD_TEACHER));

dataImportRouter.get("/templates", (_req, res) => {
  res.json({
    success: true,
    message: "模板字段",
    data: {
      students: ["studentNo", "name", "grade", "className", "subjectCombination", "interests", "careerGoal"],
      examResults: ["studentNo", "examName", "examDate", "subject", "score"]
    }
  });
});

dataImportRouter.post("/students", (req, res) => {
  const parsed = studentImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "学生导入数据格式错误" });
    return;
  }

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO students (student_no, name, grade, class_name, subject_combination, interests, career_goal, parent_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  );

  let imported = 0;
  for (const row of parsed.data.rows) {
    const info = stmt.run(
      row.studentNo,
      row.name,
      row.grade,
      row.className,
      row.subjectCombination ?? null,
      row.interests ?? null,
      row.careerGoal ?? null,
      dayjs().toISOString()
    );

    if (info.changes > 0) {
      imported += 1;
    }
  }

  res.json({ success: true, message: "导入完成", data: { imported } });
});

dataImportRouter.post("/exam-results", (req, res) => {
  const parsed = examImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "成绩导入数据格式错误" });
    return;
  }

  const insert = db.prepare(
    `INSERT INTO exam_results (student_id, subject, exam_name, exam_date, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const find = db.prepare("SELECT id FROM students WHERE student_no = ?");

  let imported = 0;
  for (const row of parsed.data.rows) {
    const student = find.get(row.studentNo) as { id: number } | undefined;
    if (!student) {
      continue;
    }

    insert.run(student.id, row.subject, row.examName, row.examDate, row.score, dayjs().toISOString());
    imported += 1;
  }

  res.json({ success: true, message: "导入完成", data: { imported } });
});
