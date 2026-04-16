import { Router } from "express";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

export const studentsRouter = Router();

studentsRouter.get("/", requireAuth, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ success: false, message: "未登录" });
    return;
  }

  const grade = typeof req.query.grade === "string" ? req.query.grade : undefined;

  const baseSelect = `SELECT id, student_no as studentNo, name, grade, class_name as className,
                  subject_combination as subjectCombination, interests, career_goal as careerGoal
           FROM students`;

  let rows: unknown[] = [];
  if (req.user.role === ROLES.ADMIN) {
    rows = grade
      ? db.prepare(`${baseSelect} WHERE grade = ? ORDER BY id ASC`).all(grade)
      : db.prepare(`${baseSelect} ORDER BY id ASC`).all();
  } else if (req.user.role === ROLES.TEACHER || req.user.role === ROLES.HEAD_TEACHER) {
    rows = grade
      ? db
          .prepare(
            `${baseSelect}
             WHERE grade = ? AND class_name IN (
               SELECT class_name FROM teacher_class_links WHERE teacher_user_id = ?
             )
             ORDER BY id ASC`
          )
          .all(grade, req.user.id)
      : db
          .prepare(
            `${baseSelect}
             WHERE class_name IN (
               SELECT class_name FROM teacher_class_links WHERE teacher_user_id = ?
             )
             ORDER BY id ASC`
          )
          .all(req.user.id);
  } else if (req.user.role === ROLES.PARENT) {
    rows = db
      .prepare(
        `${baseSelect}
         WHERE id IN (
           SELECT student_id FROM parent_student_links WHERE parent_user_id = ?
         )
         ORDER BY id ASC`
      )
      .all(req.user.id);
  } else {
    rows = db
      .prepare(`${baseSelect} WHERE id = ? ORDER BY id ASC`)
      .all(req.user.linkedStudentId ?? -1);
  }

  res.json({ success: true, message: "查询成功", data: rows });
});
