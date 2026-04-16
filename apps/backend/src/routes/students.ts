import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const studentsRouter = Router();

studentsRouter.get("/", requireAuth, (req, res) => {
  const grade = typeof req.query.grade === "string" ? req.query.grade : undefined;

  const rows = grade
    ? db
        .prepare(
          `SELECT id, student_no as studentNo, name, grade, class_name as className,
                  subject_combination as subjectCombination, interests, career_goal as careerGoal
           FROM students WHERE grade = ?
           ORDER BY id ASC`
        )
        .all(grade)
    : db
        .prepare(
          `SELECT id, student_no as studentNo, name, grade, class_name as className,
                  subject_combination as subjectCombination, interests, career_goal as careerGoal
           FROM students
           ORDER BY id ASC`
        )
        .all();

  res.json({ success: true, message: "查询成功", data: rows });
});
