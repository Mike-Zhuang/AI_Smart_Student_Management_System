import { Router } from "express";
import { z } from "zod";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { canAccessStudent, requireAuth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";
import {
    ACADEMIC_STAGE_OPTIONS,
    FIRST_SUBJECT_OPTIONS,
    SECONDARY_SUBJECT_OPTIONS,
    buildSubjectCombination,
    getAllowedStagesByGrade,
    isValidStageForGrade,
    normalizeStageFromGrade,
    parseSubjectCombination,
    validateSelectionByStage
} from "../utils/subjectRules.js";

export const studentsRouter = Router();

const updateSubjectSelectionSchema = z.object({
    academicStage: z.enum(ACADEMIC_STAGE_OPTIONS).optional(),
    firstSelectedSubject: z.string().nullable().optional(),
    secondSelectedSubject: z.string().nullable().optional(),
    thirdSelectedSubject: z.string().nullable().optional()
});

studentsRouter.get("/subject-rules", requireAuth, (_req, res) => {
    res.json({
        success: true,
        message: "查询成功",
        data: {
            firstSubjectOptions: FIRST_SUBJECT_OPTIONS,
            secondarySubjectOptions: SECONDARY_SUBJECT_OPTIONS,
            academicStages: ACADEMIC_STAGE_OPTIONS,
            rules: {
                lockedStage: "高一上",
                selectableStages: ["高一下", "高二", "高三"],
                stageByGrade: {
                    高一: getAllowedStagesByGrade("高一"),
                    高二: getAllowedStagesByGrade("高二"),
                    高三: getAllowedStagesByGrade("高三")
                }
            }
        }
    });
});

studentsRouter.get("/", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const grade = typeof req.query.grade === "string" ? req.query.grade : undefined;

    const baseSelect = `SELECT id, student_no as studentNo, name, grade, class_name as className,
                  subject_combination as subjectCombination,
                  academic_stage as academicStage,
                  subject_selection_status as selectionStatus,
                  first_selected_subject as firstSelectedSubject,
                  second_selected_subject as secondSelectedSubject,
                  third_selected_subject as thirdSelectedSubject,
                  interests, career_goal as careerGoal
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

studentsRouter.patch("/:id/subject-selection", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const studentId = Number(req.params.id);
    if (Number.isNaN(studentId)) {
        res.status(400).json({ success: false, message: "学生ID不合法" });
        return;
    }

    const parsed = updateSubjectSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const role = req.user.role;
    const canUpdateRole = role === ROLES.ADMIN || role === ROLES.TEACHER || role === ROLES.HEAD_TEACHER || role === ROLES.STUDENT;
    if (!canUpdateRole) {
        res.status(403).json({ success: false, message: "当前角色无权限修改选课信息" });
        return;
    }

    if (!canAccessStudent(req, studentId)) {
        res.status(403).json({ success: false, message: "无权修改该学生选课信息" });
        return;
    }

    const student = db
        .prepare(
            `SELECT id, name, grade,
                    academic_stage as academicStage,
                    first_selected_subject as firstSelectedSubject,
                    second_selected_subject as secondSelectedSubject,
                    third_selected_subject as thirdSelectedSubject,
                    subject_combination as subjectCombination
             FROM students
             WHERE id = ?`
        )
        .get(studentId) as
        | {
            id: number;
            name: string;
            grade: string;
            academicStage: string | null;
            firstSelectedSubject: string | null;
            secondSelectedSubject: string | null;
            thirdSelectedSubject: string | null;
            subjectCombination: string | null;
        }
        | undefined;

    if (!student) {
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }

    const stageFromDb =
        student.academicStage &&
        (student.academicStage === "高一上" || student.academicStage === "高一下" || student.academicStage === "高二" || student.academicStage === "高三")
            ? student.academicStage
            : normalizeStageFromGrade(student.grade, student.id);

    const stage = parsed.data.academicStage ?? stageFromDb;

    if (role === ROLES.STUDENT && parsed.data.academicStage && parsed.data.academicStage !== stageFromDb) {
        res.status(403).json({ success: false, message: "学生角色不能自行修改学段" });
        return;
    }

    if (!isValidStageForGrade(student.grade, stage)) {
        res.status(400).json({ success: false, message: `${student.grade}仅允许学段: ${getAllowedStagesByGrade(student.grade).join("/")}` });
        return;
    }

    const parsedCombination = parseSubjectCombination(student.subjectCombination);
    const firstSelectedSubject = parsed.data.firstSelectedSubject ?? student.firstSelectedSubject ?? parsedCombination.first;
    const secondSelectedSubject = parsed.data.secondSelectedSubject ?? student.secondSelectedSubject ?? parsedCombination.second;
    const thirdSelectedSubject = parsed.data.thirdSelectedSubject ?? student.thirdSelectedSubject ?? parsedCombination.third;

    const validated = validateSelectionByStage({
        stage,
        firstSelectedSubject,
        secondSelectedSubject,
        thirdSelectedSubject
    });

    if (!validated.ok) {
        res.status(400).json({ success: false, message: validated.message });
        return;
    }

    const subjectCombination =
        validated.subjectCombination ??
        buildSubjectCombination(validated.firstSelectedSubject, validated.secondSelectedSubject, validated.thirdSelectedSubject);

    db.prepare(
        `UPDATE students
         SET academic_stage = ?,
             subject_selection_status = ?,
             first_selected_subject = ?,
             second_selected_subject = ?,
             third_selected_subject = ?,
             subject_combination = ?
         WHERE id = ?`
    ).run(
        stage,
        validated.selectionStatus,
        validated.firstSelectedSubject,
        validated.secondSelectedSubject,
        validated.thirdSelectedSubject,
        subjectCombination,
        studentId
    );

    logAudit({
        userId: req.user.id,
        actionModule: "students",
        actionType: "subject_selection_update",
        objectType: "student",
        objectId: studentId,
        detail: {
            stage,
            selectionStatus: validated.selectionStatus,
            subjectCombination
        },
        ipAddress: extractIp(req)
    });

    res.json({
        success: true,
        message: "更新成功",
        data: {
            id: studentId,
            academicStage: stage,
            selectionStatus: validated.selectionStatus,
            firstSelectedSubject: validated.firstSelectedSubject,
            secondSelectedSubject: validated.secondSelectedSubject,
            thirdSelectedSubject: validated.thirdSelectedSubject,
            subjectCombination
        }
    });
});
