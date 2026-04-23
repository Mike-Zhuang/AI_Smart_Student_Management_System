import type { NextFunction, Response } from "express";
import dayjs from "dayjs";
import { ROLES, type Role } from "../constants.js";
import { db } from "../db.js";
import type { AuthedRequest } from "../types.js";
import { verifyAccessToken } from "../utils/auth.js";
import { validateSessionForAccess } from "../utils/sessionAuth.js";

export const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        res.status(401).json({ success: false, message: "缺少访问令牌" });
        return;
    }

    const token = header.slice(7);
    const payload = verifyAccessToken(token);
    if (!payload) {
        res.status(401).json({ success: false, message: "令牌无效或已过期" });
        return;
    }

    const sessionState = validateSessionForAccess(payload.sessionId, payload.user.id);
    if (!sessionState.ok || !sessionState.session) {
        res.status(401).json({ success: false, message: "登录会话已失效，请重新登录" });
        return;
    }

    const currentUser = db.prepare(
        `SELECT id,
                username,
                display_name as displayName,
                role,
                linked_student_id as linkedStudentId,
                must_change_password as mustChangePassword,
                password_reset_at as passwordResetAt,
                is_active as isActive
         FROM users
         WHERE id = ?`
    ).get(payload.user.id) as
        | {
            id: number;
            username: string;
            displayName: string;
            role: Role;
            linkedStudentId: number | null;
            mustChangePassword: number;
            passwordResetAt: string | null;
            isActive: number;
        }
        | undefined;

    if (!currentUser || !currentUser.isActive) {
        res.status(401).json({ success: false, message: "账号已失效，请重新登录" });
        return;
    }

    if (currentUser.passwordResetAt && dayjs(currentUser.passwordResetAt).isAfter(dayjs(sessionState.session.createdAt))) {
        res.status(401).json({ success: false, message: "密码已变更，请重新登录" });
        return;
    }

    req.sessionId = payload.sessionId;
    req.sessionExpiresAt = sessionState.session.expiresAt;
    req.user = {
        id: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
        role: currentUser.role,
        linkedStudentId: currentUser.linkedStudentId,
        mustChangePassword: Boolean(currentUser.mustChangePassword)
    };
    db.prepare(`UPDATE auth_sessions SET last_used_at = ?, updated_at = ? WHERE id = ?`).run(
        dayjs().toISOString(),
        dayjs().toISOString(),
        payload.sessionId
    );
    next();
};

export const requireRole = (...roles: Role[]) => {
    return (req: AuthedRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ success: false, message: "未登录" });
            return;
        }

        if (!roles.includes(req.user.role)) {
            res.status(403).json({ success: false, message: "无权限访问该资源" });
            return;
        }

        next();
    };
};

export const canAccessStudent = (req: AuthedRequest, studentId: number): boolean => {
    if (!req.user) {
        return false;
    }

    if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.TEACHER || req.user.role === ROLES.HEAD_TEACHER) {
        if (req.user.role === ROLES.ADMIN) {
            return true;
        }

        const teacherAccess = db
            .prepare(
                `SELECT 1
         FROM teacher_class_links tcl
         JOIN students s ON s.class_name = tcl.class_name
         WHERE tcl.teacher_user_id = ? AND s.id = ?
         LIMIT 1`
            )
            .get(req.user.id, studentId);

        return Boolean(teacherAccess);
    }

    if (req.user.role === ROLES.PARENT) {
        const parentAccess = db
            .prepare(
                `SELECT 1
         FROM parent_student_links
         WHERE parent_user_id = ? AND student_id = ?
         LIMIT 1`
            )
            .get(req.user.id, studentId);

        return Boolean(parentAccess);
    }

    if (req.user.role === ROLES.STUDENT) {
        return req.user.linkedStudentId === studentId;
    }

    return false;
};
