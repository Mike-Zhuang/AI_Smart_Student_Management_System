import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { db } from "../db.js";
import { ROLES } from "../constants.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { comparePassword, generateTemporaryPassword, hashPassword, signToken } from "../utils/auth.js";
import type { AuthUser, AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";

const loginSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(6)
});

const registerSchema = z.object({
    username: z.string().min(3),
    displayName: z.string().min(2),
    password: z.string().min(6),
    inviteCode: z.string().min(6),
    studentNo: z.string().optional()
});

const updateProfileSchema = z.object({
    displayName: z.string().min(2).max(40).optional(),
    phone: z.string().max(30).optional(),
    email: z.union([z.string().email().max(120), z.literal("")]).optional()
});

const changePasswordSchema = z.object({
    oldPassword: z.string().min(6),
    newPassword: z.string().min(8)
});

export const authRouter = Router();

const toAuthPayload = (user: {
    id: number;
    username: string;
    displayName: string;
    role: AuthUser["role"];
    linkedStudentId: number | null;
    mustChangePassword?: boolean | number | null;
}): AuthUser => {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        linkedStudentId: user.linkedStudentId,
        mustChangePassword: Boolean(user.mustChangePassword)
    };
};

const getUserById = (id: number) => {
    return db
        .prepare(
            `SELECT id, username, display_name as displayName, password_hash as passwordHash, role,
                    linked_student_id as linkedStudentId, phone, email,
                    must_change_password as mustChangePassword,
                    password_reset_at as passwordResetAt,
                    is_active as isActive,
                    created_at as createdAt
             FROM users
             WHERE id = ?`
        )
        .get(id) as
        | {
            id: number;
            username: string;
            displayName: string;
            passwordHash: string;
            role: AuthUser["role"];
            linkedStudentId: number | null;
            phone: string | null;
            email: string | null;
            mustChangePassword: number;
            passwordResetAt: string | null;
            isActive: number;
            createdAt: string;
        }
        | undefined;
};

authRouter.post("/login", (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const user = db
        .prepare(
            `SELECT id, username, display_name as displayName, password_hash as passwordHash, role, linked_student_id as linkedStudentId
                    , must_change_password as mustChangePassword, is_active as isActive
       FROM users WHERE username = ?`
        )
        .get(parsed.data.username) as
        | {
            id: number;
            username: string;
            displayName: string;
            passwordHash: string;
            role: AuthUser["role"];
            linkedStudentId: number | null;
            mustChangePassword: number;
            isActive: number;
        }
        | undefined;

    if (user && !user.isActive) {
        res.status(403).json({ success: false, message: "账号已停用，请联系管理员" });
        return;
    }

    if (!user || !comparePassword(parsed.data.password, user.passwordHash)) {
        res.status(401).json({ success: false, message: "账号或密码错误" });
        return;
    }

    const payload = toAuthPayload(user);

    const token = signToken(payload);

    logAudit({
        userId: payload.id,
        actionModule: "auth",
        actionType: "login",
        objectType: "user",
        objectId: payload.id,
        detail: { username: payload.username, role: payload.role },
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: "登录成功", data: { token, user: payload } });
});

authRouter.post("/register", (req, res) => {
    void req;
    void registerSchema;
    res.status(403).json({ success: false, message: "系统不开放公开注册，请联系管理员分配账号" });
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const user = getUserById(req.user.id);
    if (!user) {
        res.status(404).json({ success: false, message: "用户不存在" });
        return;
    }

    let roleProfile: Record<string, unknown> = {};

    if (user.role === ROLES.STUDENT) {
        const student = db
            .prepare(
                `SELECT id, student_no as studentNo, name, grade, class_name as className,
                        academic_stage as academicStage,
                        subject_selection_status as selectionStatus,
                        first_selected_subject as firstSelectedSubject,
                        second_selected_subject as secondSelectedSubject,
                        third_selected_subject as thirdSelectedSubject,
                        subject_combination as subjectCombination
                 FROM students
                 WHERE id = ?`
            )
            .get(user.linkedStudentId ?? -1);

        roleProfile = { student };
    }

    if (user.role === ROLES.PARENT) {
        const linkedStudents = db
            .prepare(
                `SELECT s.id, s.student_no as studentNo, s.name, s.grade, s.class_name as className,
                        psl.relation
                 FROM parent_student_links psl
                 JOIN students s ON s.id = psl.student_id
                 WHERE psl.parent_user_id = ?
                 ORDER BY s.id ASC`
            )
            .all(user.id);

        roleProfile = { linkedStudents };
    }

    if (user.role === ROLES.TEACHER || user.role === ROLES.HEAD_TEACHER) {
        const classes = db
            .prepare(
                `SELECT class_name as className, subject_name as subjectName, is_head_teacher as isHeadTeacher
                 FROM teacher_class_links
                 WHERE teacher_user_id = ?
                 ORDER BY class_name ASC`
            )
            .all(user.id);

        roleProfile = { classes };
    }

    res.json({
        success: true,
        message: "查询成功",
        data: {
            user: {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                role: user.role,
                linkedStudentId: user.linkedStudentId,
                mustChangePassword: Boolean(user.mustChangePassword),
                phone: user.phone,
                email: user.email,
                isActive: Boolean(user.isActive),
                passwordResetAt: user.passwordResetAt,
                createdAt: user.createdAt
            },
            roleProfile
        }
    });
});

authRouter.patch("/me/profile", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const current = getUserById(req.user.id);
    if (!current) {
        res.status(404).json({ success: false, message: "用户不存在" });
        return;
    }

    const displayName = parsed.data.displayName?.trim() || current.displayName;
    const phone = parsed.data.phone !== undefined ? (parsed.data.phone.trim() || null) : current.phone;
    const email = parsed.data.email !== undefined ? (parsed.data.email.trim() || null) : current.email;

    db.prepare(
        `UPDATE users
         SET display_name = ?, phone = ?, email = ?
         WHERE id = ?`
    ).run(displayName, phone, email, req.user.id);

    const updated = getUserById(req.user.id);
    if (!updated) {
        res.status(404).json({ success: false, message: "更新后用户不存在" });
        return;
    }

    const payload = toAuthPayload(updated);
    const token = signToken(payload);

    logAudit({
        userId: req.user.id,
        actionModule: "auth",
        actionType: "profile_update",
        objectType: "user",
        objectId: req.user.id,
        detail: { displayName, phone, email },
        ipAddress: extractIp(req)
    });

    res.json({
        success: true,
        message: "资料更新成功",
        data: {
            token,
            user: payload,
            profile: {
                phone: updated.phone,
                email: updated.email
            }
        }
    });
});

authRouter.patch("/me/password", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    if (parsed.data.oldPassword === parsed.data.newPassword) {
        res.status(400).json({ success: false, message: "新密码不能与旧密码相同" });
        return;
    }

    const user = getUserById(req.user.id);
    if (!user) {
        res.status(404).json({ success: false, message: "用户不存在" });
        return;
    }

    if (!comparePassword(parsed.data.oldPassword, user.passwordHash)) {
        res.status(400).json({ success: false, message: "旧密码错误" });
        return;
    }

    db.prepare(
        `UPDATE users
         SET password_hash = ?, must_change_password = 0, password_reset_at = ?
         WHERE id = ?`
    ).run(hashPassword(parsed.data.newPassword), dayjs().toISOString(), req.user.id);

    const updated = getUserById(req.user.id);
    if (!updated) {
        res.status(404).json({ success: false, message: "更新后用户不存在" });
        return;
    }

    const token = signToken(toAuthPayload(updated));

    logAudit({
        userId: req.user.id,
        actionModule: "auth",
        actionType: "password_change",
        objectType: "user",
        objectId: req.user.id,
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: "密码修改成功", data: { token, user: toAuthPayload(updated) } });
});

authRouter.get("/accounts", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (_req, res) => {
    const rows = db
        .prepare(
            `SELECT u.id, u.username, u.display_name as displayName, u.role,
                    u.linked_student_id as linkedStudentId,
                    u.must_change_password as mustChangePassword,
                    u.password_reset_at as passwordResetAt,
                    u.is_active as isActive,
                    u.created_at as createdAt,
                    s.student_no as studentNo,
                    s.name as studentName,
                    s.class_name as className
             FROM users u
             LEFT JOIN students s ON s.id = u.linked_student_id
             ORDER BY u.created_at DESC
             LIMIT 200`
        )
        .all();

    res.json({ success: true, message: "查询成功", data: rows });
});

authRouter.post("/accounts/:id/reset-password", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (req: AuthedRequest, res) => {
    const routeUserId = Number(req.params.id);
    if (Number.isNaN(routeUserId) || routeUserId <= 0 || !req.user) {
        res.status(400).json({ success: false, message: "用户ID不合法" });
        return;
    }

    const target = getUserById(routeUserId);
    if (!target) {
        res.status(404).json({ success: false, message: "目标账号不存在" });
        return;
    }

    const temporaryPassword = generateTemporaryPassword();
    db.prepare(
        `UPDATE users
         SET password_hash = ?, must_change_password = 1, password_reset_at = ?, is_active = 1
         WHERE id = ?`
    ).run(hashPassword(temporaryPassword), dayjs().toISOString(), target.id);

    logAudit({
        userId: req.user.id,
        actionModule: "auth",
        actionType: "reset_password",
        objectType: "user",
        objectId: target.id,
        detail: { targetUsername: target.username, targetRole: target.role },
        ipAddress: extractIp(req)
    });

    res.json({
        success: true,
        message: "密码已重置",
        data: {
            userId: target.id,
            username: target.username,
            displayName: target.displayName,
            role: target.role,
            temporaryPassword,
            mustChangePassword: true
        }
    });
});

authRouter.get("/demo-accounts", requireAuth, requireRole(ROLES.ADMIN), (_req, res) => {
    res.json({
        success: true,
        message: "演示账号",
        data: [
            { role: "admin", username: "admin", password: "admin123" },
            { role: "teacher", username: "teacher_zhang", password: "teacher123" },
            { role: "teacher", username: "teacher_wu", password: "teacher123" },
            { role: "head_teacher", username: "head_li", password: "head123" },
            { role: "head_teacher", username: "head_chen", password: "head123" },
            { role: "parent", username: "parent_wang", password: "parent123" },
            { role: "parent", username: "parent_liu", password: "parent123" },
            { role: "student", username: "student_001", password: "student123" },
            { role: "student", username: "student_002", password: "student123" }
        ]
    });
});
