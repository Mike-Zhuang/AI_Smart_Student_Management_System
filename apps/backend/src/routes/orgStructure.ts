import { Router } from "express";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { normalizeClassName, repairText } from "../utils/text.js";

type TeacherClassLinkRow = {
    teacherUserId: number;
    username: string;
    displayName: string;
    role: string;
    className: string;
    subjectName: string | null;
    isHeadTeacher: number;
};

type StudentRow = {
    id: number;
    studentNo: string;
    name: string;
    grade: string;
    className: string;
};

export const orgStructureRouter = Router();

const loadTeacherClassLinks = (): TeacherClassLinkRow[] => {
    return db.prepare(
        `SELECT tcl.teacher_user_id as teacherUserId, u.username, u.display_name as displayName, u.role,
                tcl.class_name as className, tcl.subject_name as subjectName, tcl.is_head_teacher as isHeadTeacher
         FROM teacher_class_links tcl
         JOIN users u ON u.id = tcl.teacher_user_id
         ORDER BY tcl.class_name ASC, tcl.is_head_teacher DESC, u.display_name ASC`
    ).all() as TeacherClassLinkRow[];
};

const loadStudents = (): StudentRow[] => {
    return db.prepare(
        `SELECT id, student_no as studentNo, name, grade, class_name as className
         FROM students
         ORDER BY class_name ASC, student_no ASC, id ASC`
    ).all() as StudentRow[];
};

const buildOrgOverview = () => {
    const teacherLinks = loadTeacherClassLinks();
    const students = loadStudents();

    const classMap = new Map<string, {
        className: string;
        headTeachers: Array<{ teacherUserId: number; displayName: string; subjectName: string | null }>;
        teachers: Array<{ teacherUserId: number; displayName: string; username: string; subjectName: string | null; isHeadTeacher: boolean }>;
        students: Array<{ id: number; studentNo: string; name: string; grade: string }>;
    }>();
    const teacherMap = new Map<number, {
        teacherUserId: number;
        username: string;
        displayName: string;
        role: string;
        classes: Array<{ className: string; subjectName: string | null; isHeadTeacher: boolean }>;
    }>();

    teacherLinks.forEach((link) => {
        const normalizedClassName = normalizeClassName(link.className);
        if (!classMap.has(normalizedClassName)) {
            classMap.set(normalizedClassName, {
                className: normalizedClassName,
                headTeachers: [],
                teachers: [],
                students: []
            });
        }

        const classNode = classMap.get(normalizedClassName);
        if (classNode) {
            if (link.isHeadTeacher) {
                classNode.headTeachers.push({
                    teacherUserId: link.teacherUserId,
                    displayName: repairText(link.displayName),
                    subjectName: link.subjectName ? repairText(link.subjectName) : null
                });
            }
            classNode.teachers.push({
                teacherUserId: link.teacherUserId,
                displayName: repairText(link.displayName),
                username: link.username,
                subjectName: link.subjectName ? repairText(link.subjectName) : null,
                isHeadTeacher: Boolean(link.isHeadTeacher)
            });
        }

        if (!teacherMap.has(link.teacherUserId)) {
            teacherMap.set(link.teacherUserId, {
                teacherUserId: link.teacherUserId,
                username: link.username,
                displayName: repairText(link.displayName),
                role: link.role,
                classes: []
            });
        }

        const teacherNode = teacherMap.get(link.teacherUserId);
        teacherNode?.classes.push({
            className: normalizedClassName,
            subjectName: link.subjectName ? repairText(link.subjectName) : null,
            isHeadTeacher: Boolean(link.isHeadTeacher)
        });
    });

    students.forEach((student) => {
        const normalizedClassName = normalizeClassName(student.className);
        if (!classMap.has(normalizedClassName)) {
            classMap.set(normalizedClassName, {
                className: normalizedClassName,
                headTeachers: [],
                teachers: [],
                students: []
            });
        }

        classMap.get(normalizedClassName)?.students.push({
            id: student.id,
            studentNo: student.studentNo,
            name: repairText(student.name),
            grade: repairText(student.grade)
        });
    });

    const classes = Array.from(classMap.values())
        .map((item) => ({
            className: item.className,
            headTeachers: item.headTeachers,
            teachers: item.teachers,
            students: item.students,
            studentCount: item.students.length
        }))
        .sort((left, right) => left.className.localeCompare(right.className, "zh-Hans-CN"));

    const teachers = Array.from(teacherMap.values())
        .map((item) => ({
            ...item,
            totalClasses: item.classes.length,
            headTeacherClasses: item.classes.filter((classItem) => classItem.isHeadTeacher).map((classItem) => classItem.className)
        }))
        .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-Hans-CN"));

    return {
        summary: {
            classCount: classes.length,
            teacherCount: teachers.length,
            studentCount: students.length,
            headTeacherCount: teachers.filter((teacher) => teacher.headTeacherClasses.length > 0).length
        },
        classes,
        teachers
    };
};

orgStructureRouter.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER));

orgStructureRouter.get("/overview", (_req, res) => {
    res.json({ success: true, message: "查询成功", data: buildOrgOverview() });
});

orgStructureRouter.get("/classes/:className", (req, res) => {
    const className = normalizeClassName(req.params.className);
    const data = buildOrgOverview();
    const target = data.classes.find((item) => item.className === className);
    if (!target) {
        res.status(404).json({ success: false, message: "班级不存在" });
        return;
    }

    res.json({ success: true, message: "查询成功", data: target });
});

orgStructureRouter.get("/teachers/:teacherUserId", (req, res) => {
    const teacherUserId = Number(req.params.teacherUserId);
    if (Number.isNaN(teacherUserId) || teacherUserId <= 0) {
        res.status(400).json({ success: false, message: "教师ID不合法" });
        return;
    }

    const data = buildOrgOverview();
    const target = data.teachers.find((item) => item.teacherUserId === teacherUserId);
    if (!target) {
        res.status(404).json({ success: false, message: "教师不存在" });
        return;
    }

    res.json({ success: true, message: "查询成功", data: target });
});
