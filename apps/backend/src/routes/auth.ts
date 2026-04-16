import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { db } from "../db.js";
import { ROLES } from "../constants.js";
import { comparePassword, hashPassword, signToken } from "../utils/auth.js";
import type { AuthUser } from "../types.js";
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

export const authRouter = Router();

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

    const payload: AuthUser = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        linkedStudentId: user.linkedStudentId
    };

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
