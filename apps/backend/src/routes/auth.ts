import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { db } from "../db.js";
import { ROLES } from "../constants.js";
import { requireAuth } from "../middleware/auth.js";
import { comparePassword, hashPassword, signToken } from "../utils/auth.js";
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
}): AuthUser => {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        linkedStudentId: user.linkedStudentId
    };
};

const getUserById = (id: number) => {
    return db
        .prepare(
            `SELECT id, username, display_name as displayName, password_hash as passwordHash, role,
                    linked_student_id as linkedStudentId, phone, email, created_at as createdAt
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
        }
        | undefined;

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
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(parsed.data.username) as { id: number } | undefined;
    if (exists) {
        res.status(409).json({ success: false, message: "用户名已存在" });
        return;
    }

    const invite = db
        .prepare(`SELECT id, role, expires_at as expiresAt, used FROM invite_codes WHERE code = ?`)
        .get(parsed.data.inviteCode) as
        | {
            id: number;
            role: AuthUser["role"];
            expiresAt: string;
            used: number;
        }
        | undefined;

    if (!invite) {
        res.status(400).json({ success: false, message: "邀请码无效" });
        return;
    }

    if (invite.used) {
        res.status(400).json({ success: false, message: "邀请码已使用" });
        return;
    }

    if (dayjs(invite.expiresAt).isBefore(dayjs())) {
        res.status(400).json({ success: false, message: "邀请码已过期" });
        return;
    }

    let linkedStudentId: number | null = null;
    if ((invite.role === ROLES.STUDENT || invite.role === ROLES.PARENT) && parsed.data.studentNo) {
        const student = db
            .prepare("SELECT id FROM students WHERE student_no = ?")
            .get(parsed.data.studentNo) as { id: number } | undefined;
        linkedStudentId = student?.id ?? null;
    }

    const result = db
        .prepare(
            `INSERT INTO users (username, display_name, password_hash, role, linked_student_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
            parsed.data.username,
            parsed.data.displayName,
            hashPassword(parsed.data.password),
            invite.role,
            linkedStudentId,
            dayjs().toISOString()
        );

    db.prepare("UPDATE invite_codes SET used = 1 WHERE id = ?").run(invite.id);

    const payload: AuthUser = {
        id: Number(result.lastInsertRowid),
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        role: invite.role,
        linkedStudentId
    };

    const token = signToken(payload);

    logAudit({
        userId: payload.id,
        actionModule: "auth",
        actionType: "register",
        objectType: "user",
        objectId: payload.id,
        detail: { username: payload.username, role: payload.role, inviteCode: parsed.data.inviteCode },
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: "注册成功", data: { token, user: payload } });
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
                phone: user.phone,
                email: user.email,
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

    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(parsed.data.newPassword), req.user.id);

    logAudit({
        userId: req.user.id,
        actionModule: "auth",
        actionType: "password_change",
        objectType: "user",
        objectId: req.user.id,
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: "密码修改成功" });
});

authRouter.get("/demo-accounts", (_req, res) => {
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
