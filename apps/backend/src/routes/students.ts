import { Router } from "express";
import { z } from "zod";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { canAccessStudent, requireAuth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";
import { deleteUserWithIssuance } from "../utils/accountMaintenance.js";
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

const batchDeleteSchema = z.object({
    ids: z.array(z.number().int().positive()).min(1)
});

const classBatchDeleteSchema = z.object({
    classNames: z.array(z.string().min(2)).min(1)
});

const removeOrphanParentAccounts = (): number[] => {
    const rows = db.prepare(
        `SELECT u.id
         FROM users u
         WHERE u.role = ?
           AND NOT EXISTS (
             SELECT 1 FROM parent_student_links psl WHERE psl.parent_user_id = u.id
           )`
    ).all(ROLES.PARENT) as Array<{ id: number }>;

    rows.forEach((item) => deleteUserWithIssuance(db, item.id));
    return rows.map((item) => item.id);
};

const removeTeacherAccountsWithoutClasses = (): number[] => {
    const rows = db.prepare(
        `SELECT u.id
         FROM users u
         WHERE u.role IN (?, ?)
           AND NOT EXISTS (
             SELECT 1 FROM teacher_class_links tcl WHERE tcl.teacher_user_id = u.id
           )`
    ).all(ROLES.TEACHER, ROLES.HEAD_TEACHER) as Array<{ id: number }>;

    rows.forEach((item) => deleteUserWithIssuance(db, item.id));
    return rows.map((item) => item.id);
};

const deleteStudentById = (studentId: number): void => {
    const studentAccountIds = (db.prepare(
        `SELECT id
         FROM users
         WHERE linked_student_id = ? AND role = ?`
    ).all(studentId, ROLES.STUDENT) as Array<{ id: number }>).map((item) => item.id);

    db.prepare(`DELETE FROM exam_results WHERE student_id = ?`).run(studentId);
    db.prepare(`DELETE FROM behavior_records WHERE student_id = ?`).run(studentId);
    db.prepare(`DELETE FROM growth_profiles WHERE student_id = ?`).run(studentId);
    db.prepare(`DELETE FROM alerts WHERE student_id = ?`).run(studentId);
    db.prepare(`DELETE FROM leave_requests WHERE student_id = ?`).run(studentId);
    db.prepare(`DELETE FROM career_recommendations WHERE student_id = ?`).run(studentId);
    db.prepare(`DELETE FROM parent_student_links WHERE student_id = ?`).run(studentId);
    studentAccountIds.forEach((userId) => deleteUserWithIssuance(db, userId));
    db.prepare(`DELETE FROM students WHERE id = ?`).run(studentId);
};

studentsRouter.get("/subject-rules", requireAuth, (_req, res) => {
    res.json({
        success: true,
        message: "查询成功",
        data: {
            firstSubjectOptions: FIRST_SUBJECT_OPTIONS,
            secondarySubjectOptions: SECONDARY_SUBJECT_OPTIONS,
            academicStages: ACADEMIC_STAGE_OPTIONS,
            rules: {
                lockedStage: null,
                selectableStages: ["高一上", "高一下", "高二", "高三"],
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

studentsRouter.delete("/:id", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const studentId = Number(req.params.id);
    if (Number.isNaN(studentId)) {
        res.status(400).json({ success: false, message: "学生ID不合法" });
        return;
    }

    const canDeleteRole =
        req.user.role === ROLES.ADMIN || req.user.role === ROLES.TEACHER || req.user.role === ROLES.HEAD_TEACHER;
    if (!canDeleteRole) {
        res.status(403).json({ success: false, message: "当前角色无权限删除学生" });
        return;
    }

    if (!canAccessStudent(req, studentId)) {
        res.status(403).json({ success: false, message: "无权删除该学生" });
        return;
    }

    const student = db
        .prepare(
            `SELECT id, student_no as studentNo, name, grade, class_name as className
             FROM students
             WHERE id = ?`
        )
        .get(studentId) as
        | {
            id: number;
            studentNo: string;
            name: string;
            grade: string;
            className: string;
        }
        | undefined;

    if (!student) {
        res.status(404).json({ success: false, message: "学生不存在" });
        return;
    }

    const countBeforeDelete = (tableName: string, fieldName = "student_id"): number => {
        const row = db.prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE ${fieldName} = ?`).get(studentId) as { count: number };
        return row.count;
    };

    const studentAccountCount = db
        .prepare(
            `SELECT COUNT(*) as count
             FROM users
             WHERE linked_student_id = ? AND role = ?`
        )
        .get(studentId, ROLES.STUDENT) as { count: number };

    const summary = {
        studentNo: student.studentNo,
        name: student.name,
        examResultCount: countBeforeDelete("exam_results"),
        behaviorRecordCount: countBeforeDelete("behavior_records"),
        growthProfileCount: countBeforeDelete("growth_profiles"),
        alertCount: countBeforeDelete("alerts"),
        leaveRequestCount: countBeforeDelete("leave_requests"),
        recommendationCount: countBeforeDelete("career_recommendations"),
        parentLinkCount: countBeforeDelete("parent_student_links"),
        studentAccountCount: studentAccountCount.count
    };

    const runDelete = db.transaction(() => {
        deleteStudentById(studentId);
        removeOrphanParentAccounts();
    });

    runDelete();

    logAudit({
        userId: req.user.id,
        actionModule: "students",
        actionType: "student_delete",
        objectType: "student",
        objectId: studentId,
        detail: summary,
        ipAddress: extractIp(req)
    });

    res.json({
        success: true,
        message: `学生 ${student.name} 已删除`,
        data: summary
    });
});

studentsRouter.post("/batch-delete", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const parsed = batchDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const canDeleteRole = req.user.role === ROLES.ADMIN || req.user.role === ROLES.TEACHER || req.user.role === ROLES.HEAD_TEACHER;
    if (!canDeleteRole) {
        res.status(403).json({ success: false, message: "当前角色无权限批量删除学生" });
        return;
    }

    const rows = db
        .prepare(
            `SELECT id, student_no as studentNo, name
             FROM students
             WHERE id IN (${parsed.data.ids.map(() => "?").join(",")})`
        )
        .all(...parsed.data.ids) as Array<{ id: number; studentNo: string; name: string }>;

    const forbidden = rows.find((item) => !canAccessStudent(req, item.id));
    if (forbidden) {
        res.status(403).json({ success: false, message: `无权删除学生 ${forbidden.name}` });
        return;
    }

    const transaction = db.transaction((ids: number[]) => {
        for (const studentId of ids) {
            deleteStudentById(studentId);
        }
        removeOrphanParentAccounts();
    });

    transaction(parsed.data.ids);

    logAudit({
        userId: req.user.id,
        actionModule: "students",
        actionType: "student_batch_delete",
        objectType: "student",
        detail: { ids: parsed.data.ids, count: parsed.data.ids.length },
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: `已批量删除 ${parsed.data.ids.length} 名学生`, data: { count: parsed.data.ids.length } });
});

studentsRouter.post("/classes/batch-delete", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const parsed = classBatchDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const canDeleteRole = req.user.role === ROLES.ADMIN || req.user.role === ROLES.TEACHER || req.user.role === ROLES.HEAD_TEACHER;
    if (!canDeleteRole) {
        res.status(403).json({ success: false, message: "当前角色无权限整班删除" });
        return;
    }

    const normalizedClassNames = parsed.data.classNames.map((item) => item.trim()).filter(Boolean);
    const studentRows = db.prepare(
        `SELECT id, class_name as className
         FROM students
         WHERE class_name IN (${normalizedClassNames.map(() => "?").join(",")})`
    ).all(...normalizedClassNames) as Array<{ id: number; className: string }>;

    const forbiddenStudent = studentRows.find((item) => !canAccessStudent(req, item.id));
    if (forbiddenStudent) {
        res.status(403).json({ success: false, message: `无权删除班级 ${forbiddenStudent.className}` });
        return;
    }

    const summary = {
        classCount: normalizedClassNames.length,
        studentCount: studentRows.length,
        examResultCount: 0,
        behaviorRecordCount: 0,
        growthProfileCount: 0,
        alertCount: 0,
        leaveRequestCount: 0,
        recommendationCount: 0,
        studentAccountCount: 0,
        parentLinkCount: 0,
        classProfileCount: 0,
        classLogCount: 0,
        wellbeingPostCount: 0,
        galleryCount: 0,
        groupScoreCount: 0,
        teacherLinkCount: 0,
        retainedIssuanceBatchCount: 0,
        deletedParentAccountCount: 0,
        deletedTeacherAccountCount: 0
    };

    const countByClassSet = (table: string, field: string): number => {
        const row = db.prepare(
            `SELECT COUNT(*) as count
             FROM ${table}
             WHERE ${field} IN (${normalizedClassNames.map(() => "?").join(",")})`
        ).get(...normalizedClassNames) as { count: number };
        return row.count;
    };

    summary.classProfileCount = countByClassSet("class_profiles", "class_name");
    summary.classLogCount = countByClassSet("class_logs", "class_name");
    summary.wellbeingPostCount = countByClassSet("wellbeing_posts", "class_name");
    summary.galleryCount = countByClassSet("class_gallery", "class_name");
    summary.groupScoreCount = countByClassSet("group_score_records", "class_name");
    summary.teacherLinkCount = countByClassSet("teacher_class_links", "class_name");

    const parentUserIds = studentRows.length > 0
        ? (db.prepare(
            `SELECT DISTINCT parent_user_id as parentUserId
             FROM parent_student_links
             WHERE student_id IN (${studentRows.map(() => "?").join(",")})`
        ).all(...studentRows.map((item) => item.id)) as Array<{ parentUserId: number | null }>)
            .map((item) => item.parentUserId)
            .filter((item): item is number => typeof item === "number")
        : [];

    studentRows.forEach((item) => {
        const count = (tableName: string, fieldName = "student_id"): number => {
            const row = db.prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE ${fieldName} = ?`).get(item.id) as { count: number };
            return row.count;
        };

        summary.examResultCount += count("exam_results");
        summary.behaviorRecordCount += count("behavior_records");
        summary.growthProfileCount += count("growth_profiles");
        summary.alertCount += count("alerts");
        summary.leaveRequestCount += count("leave_requests");
        summary.recommendationCount += count("career_recommendations");
        summary.parentLinkCount += count("parent_student_links");
        summary.studentAccountCount += (db.prepare(
            `SELECT COUNT(*) as count
             FROM users
             WHERE linked_student_id = ? AND role = ?`
        ).get(item.id, ROLES.STUDENT) as { count: number }).count;
    });

    const transaction = db.transaction(() => {
        const teacherIds = (db.prepare(
            `SELECT DISTINCT teacher_user_id as teacherUserId
             FROM teacher_class_links
             WHERE class_name IN (${normalizedClassNames.map(() => "?").join(",")})`
        ).all(...normalizedClassNames) as Array<{ teacherUserId: number }>).map((item) => item.teacherUserId);
        const linkedStudentAccountIds = studentRows.length > 0
            ? (db.prepare(
                `SELECT id
                 FROM users
                 WHERE linked_student_id IN (${studentRows.map(() => "?").join(",")}) AND role = ?`
            ).all(...studentRows.map((item) => item.id), ROLES.STUDENT) as Array<{ id: number }>).map((item) => item.id)
            : [];
        const reassignedUserIds = [...new Set([...teacherIds, ...parentUserIds, ...linkedStudentAccountIds])];
        if (reassignedUserIds.length > 0) {
            summary.retainedIssuanceBatchCount = (db.prepare(
                `SELECT COUNT(*) as count
                 FROM account_issuance_batches
                 WHERE operator_user_id IN (${reassignedUserIds.map(() => "?").join(",")})`
            ).get(...reassignedUserIds) as { count: number }).count;
        }

        for (const student of studentRows) {
            deleteStudentById(student.id);
        }

        db.prepare(`DELETE FROM class_profiles WHERE class_name IN (${normalizedClassNames.map(() => "?").join(",")})`).run(...normalizedClassNames);
        db.prepare(`DELETE FROM class_logs WHERE class_name IN (${normalizedClassNames.map(() => "?").join(",")})`).run(...normalizedClassNames);
        db.prepare(`DELETE FROM wellbeing_posts WHERE class_name IN (${normalizedClassNames.map(() => "?").join(",")})`).run(...normalizedClassNames);
        db.prepare(`DELETE FROM class_gallery WHERE class_name IN (${normalizedClassNames.map(() => "?").join(",")})`).run(...normalizedClassNames);
        db.prepare(`DELETE FROM group_score_records WHERE class_name IN (${normalizedClassNames.map(() => "?").join(",")})`).run(...normalizedClassNames);
        db.prepare(`DELETE FROM student_groups WHERE class_name IN (${normalizedClassNames.map(() => "?").join(",")})`).run(...normalizedClassNames);

        db.prepare(`DELETE FROM teacher_class_links WHERE class_name IN (${normalizedClassNames.map(() => "?").join(",")})`).run(...normalizedClassNames);

        summary.deletedParentAccountCount = removeOrphanParentAccounts().length;
        summary.deletedTeacherAccountCount = removeTeacherAccountsWithoutClasses().filter((id) => teacherIds.includes(id)).length;
    });

    transaction();

    logAudit({
        userId: req.user.id,
        actionModule: "students",
        actionType: "class_batch_delete",
        objectType: "class",
        detail: { classNames: normalizedClassNames, ...summary },
        ipAddress: extractIp(req)
    });

    res.json({
        success: true,
        message: `已级联删除 ${normalizedClassNames.length} 个班级`,
        data: summary
    });
});
