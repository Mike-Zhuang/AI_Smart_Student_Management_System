import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { isProduction, securityConfig } from "../config/security.js";
import { db } from "../db.js";
import { ROLES } from "../constants.js";
import { canAccessStudent, requireAuth, requireRole } from "../middleware/auth.js";
import { assertAuthAttemptAllowed, clearAuthFailures, getAuthRiskState, recordAuthFailure } from "../middleware/rateLimit.js";
import {
    buildIssuanceWorkbookBuffer,
    createIssuanceBatch,
    getDownloadableIssuanceItems,
    invalidateUserIssuancePasswords
} from "../utils/accountIssuance.js";
import {
    clearRefreshTokenCookie,
    comparePassword,
    generateOpaqueToken,
    generateTemporaryPassword,
    getRefreshTokenFromCookie,
    hashPassword,
    setRefreshTokenCookie,
    signAccessToken,
    sha256,
    verifyRefreshToken
} from "../utils/auth.js";
import type { AuthUser, AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";
import { assertSafeBusinessText, validatePlainInput } from "../utils/contentSafety.js";
import { issueTokensAndCookie, revokeAllSessionsForUser, revokeSessionById, rotateRefreshSession } from "../utils/sessionAuth.js";
import { repairRecordStrings, repairText } from "../utils/text.js";

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,40}$/;
const PHONE_PATTERN = /^[0-9+\-() ]{6,30}$/;

const loginSchema = z.object({
    username: z.string().min(3).max(40),
    password: z.string().min(6).max(128),
    honeypot: z.string().max(0).optional().default(""),
    submittedAt: z.number().int().positive().optional(),
    riskChallengeToken: z.string().min(20).max(200).optional(),
    riskChallengeAnswer: z.string().min(1).max(20).optional()
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

const selectedIssuanceItemsSchema = z.object({
    itemIds: z.array(z.number().int().positive()).min(1)
});

const createParentAccountSchema = z.object({
    studentId: z.number().int().positive(),
    displayName: z.string().min(2).max(40),
    relation: z.string().min(2).max(20).default("监护人"),
    phone: z.string().max(30).optional(),
    username: z.string().min(4).max(40).optional()
});

const batchGenerateParentSchema = z.object({
    studentIds: z.array(z.number().int().positive()).optional()
});

export const authRouter = Router();

const validateStrongPassword = (password: string): void => {
    if (password.length < 8 || password.length > 128) {
        throw new Error("密码长度需在8到128位之间");
    }
    if (!/[A-Z]/.test(password)) {
        throw new Error("新密码需至少包含1个大写字母");
    }
    if (!/[a-z]/.test(password)) {
        throw new Error("新密码需至少包含1个小写字母");
    }
    if (!/[0-9]/.test(password)) {
        throw new Error("新密码需至少包含1个数字");
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        throw new Error("新密码需至少包含1个特殊字符");
    }
};

const sanitizeUsername = (value: string): string => validatePlainInput(value, {
    fieldName: "用户名",
    required: true,
    maxLength: 40,
    pattern: USERNAME_PATTERN
});

const sanitizePhone = (value: string | undefined): string | null => {
    if (value === undefined) {
        return null;
    }
    const normalized = validatePlainInput(value, {
        fieldName: "联系电话",
        required: false,
        maxLength: 30,
        pattern: PHONE_PATTERN
    });
    return normalized || null;
};

const buildRiskQuestion = (): { question: string; answer: string } => {
    const left = 3 + Math.floor(Math.random() * 7);
    const right = 1 + Math.floor(Math.random() * 6);
    const add = Math.random() > 0.35;
    return add
        ? { question: `${left} + ${right} = ?`, answer: String(left + right) }
        : { question: `${left} - ${right} = ?`, answer: String(left - right) };
};

const createRiskChallenge = (username: string, ipAddress: string, userAgent: string): { token: string; question: string; expiresAt: string } => {
    const token = generateOpaqueToken(24);
    const qa = buildRiskQuestion();
    const expiresAt = dayjs().add(securityConfig.riskChallengeTtlSeconds, "second").toISOString();
    db.prepare(
        `INSERT INTO risk_challenges (token_hash, username, ip_address, user_agent, question, answer_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sha256(token), username, ipAddress, userAgent, qa.question, sha256(qa.answer), expiresAt, dayjs().toISOString());
    return { token, question: qa.question, expiresAt };
};

const consumeRiskChallenge = (input: {
    username: string;
    ipAddress: string;
    userAgent: string;
    token?: string;
    answer?: string;
}): void => {
    const row = db.prepare(
        `SELECT id, answer_hash as answerHash, expires_at as expiresAt, used_at as usedAt
         FROM risk_challenges
         WHERE token_hash = ? AND username = ? AND ip_address = ? AND user_agent = ?
         ORDER BY id DESC
         LIMIT 1`
    ).get(sha256(input.token ?? ""), input.username, input.ipAddress, input.userAgent) as
        | { id: number; answerHash: string; expiresAt: string; usedAt: string | null }
        | undefined;

    if (!row || row.usedAt || dayjs(row.expiresAt).isBefore(dayjs())) {
        throw new Error("风险校验已失效，请重新获取");
    }

    if (sha256((input.answer ?? "").trim()) !== row.answerHash) {
        throw new Error("风险校验答案错误");
    }

    db.prepare(`UPDATE risk_challenges SET used_at = ? WHERE id = ?`).run(dayjs().toISOString(), row.id);
};

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
                    failed_login_count as failedLoginCount,
                    last_failed_login_at as lastFailedLoginAt,
                    locked_until as lockedUntil,
                    last_login_at as lastLoginAt,
                    last_login_ip as lastLoginIp,
                    last_login_user_agent as lastLoginUserAgent,
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
            failedLoginCount: number;
            lastFailedLoginAt: string | null;
            lockedUntil: string | null;
            lastLoginAt: string | null;
            lastLoginIp: string | null;
            lastLoginUserAgent: string | null;
            createdAt: string;
        }
        | undefined;
};

const getUserByUsername = (username: string) => {
    return db
        .prepare(
            `SELECT id, username, display_name as displayName, password_hash as passwordHash, role,
                    linked_student_id as linkedStudentId,
                    must_change_password as mustChangePassword,
                    password_reset_at as passwordResetAt,
                    is_active as isActive,
                    failed_login_count as failedLoginCount,
                    last_failed_login_at as lastFailedLoginAt,
                    locked_until as lockedUntil
             FROM users
             WHERE username = ?`
        )
        .get(username) as
        | {
            id: number;
            username: string;
            displayName: string;
            passwordHash: string;
            role: AuthUser["role"];
            linkedStudentId: number | null;
            mustChangePassword: number;
            passwordResetAt: string | null;
            isActive: number;
            failedLoginCount: number;
            lastFailedLoginAt: string | null;
            lockedUntil: string | null;
        }
        | undefined;
};

const buildDownloadFilename = (title: string): string => {
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, "-").trim() || "账号发放";
    return `${safeTitle}.xlsx`;
};

const resolveLoginUrl = (req: AuthedRequest): string => {
    if (typeof req.headers.origin === "string" && req.headers.origin.trim()) {
        return `${req.headers.origin.replace(/\/+$/, "")}/login`;
    }

    if (typeof req.headers.referer === "string" && req.headers.referer.trim()) {
        try {
            const refererUrl = new URL(req.headers.referer);
            return `${refererUrl.origin}/login`;
        } catch {
            return "请使用当前系统登录页";
        }
    }

    return "请使用当前系统登录页";
};

const buildRelatedNameForUser = (user: {
    id: number;
    role: AuthUser["role"];
    linkedStudentId: number | null;
    displayName: string;
}): string => {
    if (user.linkedStudentId) {
        const student = db.prepare(
            `SELECT student_no as studentNo, name, class_name as className
             FROM students
             WHERE id = ?`
        ).get(user.linkedStudentId) as { studentNo: string; name: string; className: string } | undefined;

        if (student) {
            return `${student.name} / ${student.studentNo} / ${student.className}`;
        }
    }

    const teacherClasses = db.prepare(
        `SELECT GROUP_CONCAT(class_name, '、') as classNames
         FROM teacher_class_links
         WHERE teacher_user_id = ?`
    ).get(user.id) as { classNames: string | null } | undefined;

    if (teacherClasses?.classNames) {
        return `${user.displayName} / ${teacherClasses.classNames}`;
    }

    return user.displayName;
};

const buildParentUsername = (studentNo: string, suffix = 0): string => {
    return suffix === 0 ? `parent_${studentNo}` : `parent_${studentNo}_${suffix}`;
};

const findAvailableUsername = (baseUsername: string): string => {
    let username = baseUsername;
    let suffix = 1;
    while (true) {
        const exists = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username) as { id: number } | undefined;
        if (!exists) {
            return username;
        }
        username = `${baseUsername}_${suffix}`;
        suffix += 1;
    }
};

const createParentAccountForStudent = (input: {
    studentId: number;
    displayName: string;
    relation: string;
    phone?: string | null;
    username?: string | null;
    operatorUserId: number;
}): { userId: number; username: string; issuanceBatchId: number | null } => {
    const student = db.prepare(
        `SELECT id, student_no as studentNo, name, class_name as className
         FROM students
         WHERE id = ?`
    ).get(input.studentId) as { id: number; studentNo: string; name: string; className: string } | undefined;

    if (!student) {
        throw new Error("学生不存在");
    }

    const desiredUsername = input.username ? sanitizeUsername(input.username) : buildParentUsername(student.studentNo);
    const username = findAvailableUsername(desiredUsername);
    const temporaryPassword = generateTemporaryPassword();
    const createdAt = dayjs().toISOString();
    const displayName = assertSafeBusinessText(input.displayName, { fieldName: "家长显示名", required: true, maxLength: 40 });
    const relation = assertSafeBusinessText(input.relation, { fieldName: "关系", required: true, maxLength: 20 });
    const phone = input.phone ? sanitizePhone(input.phone) : null;
    const result = db.prepare(
        `INSERT INTO users (
            username,
            display_name,
            password_hash,
            role,
            linked_student_id,
            phone,
            must_change_password,
            password_reset_at,
            is_active,
            created_at
        )
        VALUES (?, ?, ?, ?, NULL, ?, 1, ?, 1, ?)`
    ).run(
        username,
        displayName,
        hashPassword(temporaryPassword),
        ROLES.PARENT,
        phone,
        createdAt,
        createdAt
    );

    const parentUserId = Number(result.lastInsertRowid);
    db.prepare(
        `INSERT OR IGNORE INTO parent_student_links (parent_user_id, student_id, relation, created_at)
         VALUES (?, ?, ?, ?)`
    ).run(parentUserId, student.id, relation, createdAt);
    db.prepare(`UPDATE students SET parent_user_id = COALESCE(parent_user_id, ?) WHERE id = ?`).run(parentUserId, student.id);

    const issuanceBatchId = createIssuanceBatch(db, {
        batchType: "parent_account_create",
        sourceModule: "auth",
        operatorUserId: input.operatorUserId,
        title: `家长账号发放 ${student.name} ${dayjs().format("YYYY-MM-DD HH:mm")}`,
        note: `${displayName} 已绑定 ${student.name}`,
        items: [
            {
                userId: parentUserId,
                username,
                temporaryPassword,
                displayName,
                role: ROLES.PARENT,
                relatedName: `${student.name} / ${student.studentNo} / ${student.className}`,
                studentNo: student.studentNo,
                className: student.className
            }
        ]
    });

    return { userId: parentUserId, username, issuanceBatchId };
};

authRouter.get("/risk-challenge", (req: AuthedRequest, res) => {
    const usernameInput = typeof req.query.username === "string" ? req.query.username : "";
    let username = "";
    try {
        username = usernameInput ? sanitizeUsername(usernameInput) : "";
    } catch {
        res.status(400).json({ success: false, message: "用户名格式不合法" });
        return;
    }

    const ipAddress = extractIp(req);
    const userAgent = String(req.headers["user-agent"] ?? "unknown");
    const risk = getAuthRiskState(username, ipAddress);
    if (!risk.challengeRequired) {
        res.json({
            success: true,
            message: "当前无需额外校验",
            data: {
                required: false,
                ipAttempts: risk.ipAttempts,
                userIpAttempts: risk.userIpAttempts
            }
        });
        return;
    }

    const challenge = createRiskChallenge(username, ipAddress, userAgent);
    logAudit({
        userId: 1,
        actionModule: "auth",
        actionType: "risk_challenge_issue",
        objectType: "challenge",
        detail: { username, ipAddress },
        ipAddress
    });

    res.json({
        success: true,
        message: "请完成风险校验后继续登录",
        data: {
            required: true,
            challengeToken: challenge.token,
            challengeQuestion: challenge.question,
            expiresAt: challenge.expiresAt,
            ipAttempts: risk.ipAttempts,
            userIpAttempts: risk.userIpAttempts
        }
    });
});

authRouter.post("/login", (req: AuthedRequest, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    if (parsed.data.honeypot) {
        res.status(400).json({ success: false, message: "请求不合法" });
        return;
    }

    if (parsed.data.submittedAt && Date.now() - parsed.data.submittedAt < securityConfig.authMinSubmitDelayMs) {
        res.status(400).json({ success: false, message: "提交过快，请稍后重试" });
        return;
    }

    const ipAddress = extractIp(req);
    const userAgent = String(req.headers["user-agent"] ?? "unknown");
    let username = "";
    try {
        username = sanitizeUsername(parsed.data.username);
        assertAuthAttemptAllowed(username, ipAddress);
    } catch (error) {
        res.status(429).json({ success: false, message: error instanceof Error ? error.message : "登录请求过于频繁" });
        return;
    }

    const risk = getAuthRiskState(username, ipAddress);
    if (risk.challengeRequired) {
        try {
            consumeRiskChallenge({
                username,
                ipAddress,
                userAgent,
                token: parsed.data.riskChallengeToken,
                answer: parsed.data.riskChallengeAnswer
            });
        } catch (error) {
            res.status(403).json({ success: false, message: error instanceof Error ? error.message : "请先完成风险校验" });
            return;
        }
    }

    const user = getUserByUsername(username);
    if (user && !user.isActive) {
        res.status(403).json({ success: false, message: "账号已停用，请联系管理员" });
        return;
    }

    if (user?.lockedUntil && dayjs(user.lockedUntil).isAfter(dayjs())) {
        res.status(429).json({ success: false, message: "账号已被临时锁定，请稍后再试" });
        return;
    }

    if (!user || !comparePassword(parsed.data.password, user.passwordHash)) {
        const failure = recordAuthFailure(username, ipAddress);
        const now = dayjs().toISOString();
        if (user) {
            const nextFailedCount = user.failedLoginCount + 1;
            const shouldLock = nextFailedCount >= securityConfig.authLockMaxFailures;
            db.prepare(
                `UPDATE users
                 SET failed_login_count = ?,
                     last_failed_login_at = ?,
                     locked_until = CASE WHEN ? THEN ? ELSE locked_until END
                 WHERE id = ?`
            ).run(
                nextFailedCount,
                now,
                shouldLock ? 1 : 0,
                shouldLock ? dayjs().add(securityConfig.authLockMinutes, "minute").toISOString() : null,
                user.id
            );
        }

        logAudit({
            userId: user?.id ?? 1,
            actionModule: "auth",
            actionType: "login_failed",
            objectType: "user",
            objectId: user?.id ?? null,
            detail: {
                username,
                ipAttempts: failure.ipAttempts,
                userIpAttempts: failure.userIpAttempts,
                locked: Boolean(user && user.failedLoginCount + 1 >= securityConfig.authLockMaxFailures)
            },
            ipAddress
        });

        res.status(401).json({ success: false, message: "账号或密码错误" });
        return;
    }

    const payload = toAuthPayload(user);
    clearAuthFailures(username, ipAddress);
    db.prepare(
        `UPDATE users
         SET failed_login_count = 0,
             last_failed_login_at = NULL,
             locked_until = NULL,
             last_login_at = ?,
             last_login_ip = ?,
             last_login_user_agent = ?
         WHERE id = ?`
    ).run(dayjs().toISOString(), ipAddress, userAgent, user.id);
    const session = issueTokensAndCookie(payload, res, { ipAddress, userAgent });

    logAudit({
        userId: payload.id,
        actionModule: "auth",
        actionType: "login",
        objectType: "user",
        objectId: payload.id,
        detail: { username: payload.username, role: payload.role, sessionId: session.sessionId },
        ipAddress
    });

    res.json({ success: true, message: "登录成功", data: { token: session.accessToken, user: payload } });
});

authRouter.post("/refresh", (req: AuthedRequest, res) => {
    try {
        const refreshToken = getRefreshTokenFromCookie(req.headers.cookie);
        if (!refreshToken) {
            clearRefreshTokenCookie(res);
            res.status(401).json({ success: false, message: "刷新会话不存在，请重新登录" });
            return;
        }

        const parsedRefreshToken = verifyRefreshToken(refreshToken);
        if (!parsedRefreshToken) {
            clearRefreshTokenCookie(res);
            res.status(401).json({ success: false, message: "登录会话已失效，请重新登录" });
            return;
        }

        const sessionRow = db.prepare(
            `SELECT user_id as userId
             FROM auth_sessions
             WHERE id = ?`
        ).get(parsedRefreshToken.sessionId) as { userId: number } | undefined;
        const user = sessionRow ? getUserById(sessionRow.userId) : undefined;
        if (!user || !user.isActive) {
            clearRefreshTokenCookie(res);
            res.status(401).json({ success: false, message: "登录会话已失效，请重新登录" });
            return;
        }

        const nextSession = rotateRefreshSession(parsedRefreshToken.token, toAuthPayload(user), {
            ipAddress: extractIp(req),
            userAgent: String(req.headers["user-agent"] ?? "unknown")
        });

        if (!nextSession) {
            clearRefreshTokenCookie(res);
            res.status(401).json({ success: false, message: "登录会话已失效，请重新登录" });
            return;
        }

        setRefreshTokenCookie(res, nextSession.refreshToken);
        logAudit({
            userId: user.id,
            actionModule: "auth",
            actionType: "refresh",
            objectType: "session",
            objectId: nextSession.sessionId,
            ipAddress: extractIp(req)
        });
        res.json({ success: true, message: "刷新成功", data: { token: nextSession.accessToken, user: toAuthPayload(user) } });
    } catch {
        clearRefreshTokenCookie(res);
        res.status(500).json({ success: false, message: "会话刷新失败，请重新登录" });
    }
});

authRouter.post("/logout", requireAuth, (req: AuthedRequest, res) => {
    if (req.sessionId) {
        revokeSessionById(req.sessionId, "user_logout");
    }
    clearRefreshTokenCookie(res);
    if (req.user) {
        logAudit({
            userId: req.user.id,
            actionModule: "auth",
            actionType: "logout",
            objectType: "session",
            objectId: req.sessionId ?? null,
            ipAddress: extractIp(req)
        });
    }
    res.json({ success: true, message: "已退出登录" });
});

authRouter.post("/logout-all", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }
    const count = revokeAllSessionsForUser(req.user.id, "user_logout_all");
    clearRefreshTokenCookie(res);
    logAudit({
        userId: req.user.id,
        actionModule: "auth",
        actionType: "logout_all",
        objectType: "session",
        detail: { revokedCount: count },
        ipAddress: extractIp(req)
    });
    res.json({ success: true, message: "已退出全部设备", data: { revokedCount: count } });
});

authRouter.get("/session-status", requireAuth, (req: AuthedRequest, res) => {
    res.json({
        success: true,
        message: "会话有效",
        data: {
            user: req.user,
            sessionId: req.sessionId,
            sessionExpiresAt: req.sessionExpiresAt
        }
    });
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
            roleProfile,
            session: {
                sessionId: req.sessionId ?? null,
                sessionExpiresAt: req.sessionExpiresAt ?? null
            }
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

    const displayName = parsed.data.displayName !== undefined
        ? assertSafeBusinessText(parsed.data.displayName, { fieldName: "显示名称", required: true, maxLength: 40 })
        : current.displayName;
    const phone = parsed.data.phone !== undefined ? sanitizePhone(parsed.data.phone) : current.phone;
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
    const token = req.sessionId ? signAccessToken({ sessionId: req.sessionId, user: payload }) : null;

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

    try {
        validateStrongPassword(parsed.data.newPassword);
    } catch (error) {
        res.status(400).json({ success: false, message: error instanceof Error ? error.message : "新密码强度不足" });
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
    invalidateUserIssuancePasswords(db, req.user.id);
    revokeAllSessionsForUser(req.user.id, "password_changed");

    const updated = getUserById(req.user.id);
    if (!updated) {
        res.status(404).json({ success: false, message: "更新后用户不存在" });
        return;
    }

    const nextSession = issueTokensAndCookie(toAuthPayload(updated), res, {
        ipAddress: extractIp(req),
        userAgent: String(req.headers["user-agent"] ?? "unknown")
    });

    logAudit({
        userId: req.user.id,
        actionModule: "auth",
        actionType: "password_change",
        objectType: "user",
        objectId: req.user.id,
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: "密码修改成功", data: { token: nextSession.accessToken, user: toAuthPayload(updated) } });
});

authRouter.get("/accounts", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (_req, res) => {
    const rows = (db
        .prepare(
            `SELECT u.id, u.username, u.display_name as displayName, u.role,
                    u.linked_student_id as linkedStudentId,
                    u.must_change_password as mustChangePassword,
                    u.password_reset_at as passwordResetAt,
                    u.is_active as isActive,
                    u.created_at as createdAt,
                    s.student_no as studentNo,
                    s.name as studentName,
                    s.class_name as className,
                    (
                        SELECT GROUP_CONCAT(tcl.class_name, '、')
                        FROM teacher_class_links tcl
                        WHERE tcl.teacher_user_id = u.id
                    ) as teacherClasses,
                    (
                        SELECT GROUP_CONCAT(tcl.subject_name, '、')
                        FROM teacher_class_links tcl
                        WHERE tcl.teacher_user_id = u.id
                    ) as teacherSubjects,
                    (
                        SELECT GROUP_CONCAT(s.name || ' / ' || s.student_no || ' / ' || s.class_name, '；')
                        FROM parent_student_links psl
                        JOIN students s ON s.id = psl.student_id
                        WHERE psl.parent_user_id = u.id
                    ) as parentStudents,
                    (
                        SELECT ai.id
                        FROM account_issuance_items ai
                        WHERE ai.user_id = u.id
                        ORDER BY ai.id DESC
                        LIMIT 1
                    ) as latestIssuanceItemId,
                    (
                        SELECT ai.batch_id
                        FROM account_issuance_items ai
                        WHERE ai.user_id = u.id
                        ORDER BY ai.id DESC
                        LIMIT 1
                    ) as latestIssuanceBatchId,
                    (
                        SELECT ai.created_at
                        FROM account_issuance_items ai
                        WHERE ai.user_id = u.id
                        ORDER BY ai.id DESC
                        LIMIT 1
                    ) as latestIssuanceAt,
                    (
                        SELECT aib.title
                        FROM account_issuance_items ai
                        JOIN account_issuance_batches aib ON aib.id = ai.batch_id
                        WHERE ai.user_id = u.id
                        ORDER BY ai.id DESC
                        LIMIT 1
                    ) as latestIssuanceTitle,
                    (
                        SELECT ai.can_download_password
                        FROM account_issuance_items ai
                        WHERE ai.user_id = u.id
                        ORDER BY ai.id DESC
                        LIMIT 1
                    ) as canDownloadPassword
             FROM users u
             LEFT JOIN students s ON s.id = u.linked_student_id
             WHERE u.username != '__system_audit__'
             ORDER BY u.created_at DESC
             LIMIT 400`
        )
        .all() as Array<Record<string, unknown>>)
        .map((item) => repairRecordStrings(item));

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
    invalidateUserIssuancePasswords(db, target.id, "admin_reset_password");
    db.prepare(
        `UPDATE users
         SET password_hash = ?, must_change_password = 1, password_reset_at = ?, is_active = 1
         WHERE id = ?`
    ).run(hashPassword(temporaryPassword), dayjs().toISOString(), target.id);
    revokeAllSessionsForUser(target.id, "admin_reset_password");
    const batchId = createIssuanceBatch(db, {
        batchType: "manual_reset",
        sourceModule: "auth",
        operatorUserId: req.user.id,
        title: `人工重置密码 ${target.displayName} ${dayjs().format("YYYY-MM-DD HH:mm")}`,
        note: `为账号 ${target.username} 重新发放一次性密码`,
        items: [
            {
                userId: target.id,
                username: target.username,
                temporaryPassword,
                displayName: target.displayName,
                role: target.role,
                relatedName: buildRelatedNameForUser(target)
            }
        ]
    });

    logAudit({
        userId: req.user.id,
        actionModule: "auth",
        actionType: "reset_password",
        objectType: "user",
        objectId: target.id,
        detail: { targetUsername: target.username, targetRole: target.role, issuanceBatchId: batchId },
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
            mustChangePassword: true,
            issuanceBatchId: batchId,
            batchTitle: `人工重置密码 ${target.displayName} ${dayjs().format("YYYY-MM-DD HH:mm")}`
        }
    });
});

authRouter.post("/parent-accounts", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (req: AuthedRequest, res) => {
    const parsed = createParentAccountSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    if (!canAccessStudent(req, parsed.data.studentId)) {
        res.status(403).json({ success: false, message: "无权为该学生创建家长账号" });
        return;
    }

    try {
        const created = createParentAccountForStudent({
            ...parsed.data,
            operatorUserId: req.user.id
        });

        logAudit({
            userId: req.user.id,
            actionModule: "auth",
            actionType: "parent_account_create",
            objectType: "user",
            objectId: created.userId,
            detail: { studentId: parsed.data.studentId, username: created.username, issuanceBatchId: created.issuanceBatchId },
            ipAddress: extractIp(req)
        });

        res.json({
            success: true,
            message: "家长账号已创建",
            data: created
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error instanceof Error ? error.message : "创建家长账号失败" });
    }
});

authRouter.post("/parent-accounts/batch-generate", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (req: AuthedRequest, res) => {
    const parsed = batchGenerateParentSchema.safeParse(req.body ?? {});
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const targetRows = (parsed.data.studentIds?.length
        ? db.prepare(
            `SELECT id, student_no as studentNo, name
             FROM students
             WHERE id IN (${parsed.data.studentIds.map(() => "?").join(",")})`
        ).all(...parsed.data.studentIds)
        : db.prepare(
            `SELECT s.id, s.student_no as studentNo, s.name
             FROM students s
             WHERE NOT EXISTS (
                SELECT 1 FROM parent_student_links psl WHERE psl.student_id = s.id
             )
             ORDER BY s.id ASC`
        ).all()) as Array<{ id: number; studentNo: string; name: string }>;

    const accessibleRows = targetRows.filter((item) => canAccessStudent(req, item.id));
    if (accessibleRows.length === 0) {
        res.json({ success: true, message: "当前没有需要补齐主家长账号的学生", data: { count: 0, issuanceBatchIds: [] } });
        return;
    }

    const existingLinkedStudentIds = new Set(
        (
            db.prepare(
                `SELECT DISTINCT student_id as studentId
                 FROM parent_student_links
                 WHERE student_id IN (${accessibleRows.map(() => "?").join(",")})`
            ).all(...accessibleRows.map((item) => item.id)) as Array<{ studentId: number }>
        ).map((item) => item.studentId)
    );
    const pendingRows = accessibleRows.filter((item) => !existingLinkedStudentIds.has(item.id));
    if (pendingRows.length === 0) {
        res.json({ success: true, message: "当前没有需要补齐主家长账号的学生", data: { count: 0, issuanceBatchIds: [] } });
        return;
    }

    const createdItems = pendingRows.map((item) =>
        createParentAccountForStudent({
            studentId: item.id,
            displayName: `${item.name}家长`,
            relation: "监护人",
            operatorUserId: req.user!.id
        })
    );

    logAudit({
        userId: req.user.id,
        actionModule: "auth",
        actionType: "parent_account_batch_generate",
        objectType: "user",
        detail: { studentIds: pendingRows.map((item) => item.id), count: createdItems.length },
        ipAddress: extractIp(req)
    });

    res.json({
        success: true,
        message: `已补齐 ${createdItems.length} 个主家长账号`,
        data: {
            count: createdItems.length,
            issuanceBatchIds: createdItems.map((item) => item.issuanceBatchId).filter((item): item is number => Boolean(item))
        }
    });
});

authRouter.get("/account-issuance-batches", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (_req, res) => {
    const rows = (db
        .prepare(
            `SELECT b.id, b.batch_type as batchType, b.source_module as sourceModule, b.title, b.note, b.created_at as createdAt,
                    u.display_name as operatorName,
                    (
                        SELECT COUNT(*) FROM account_issuance_items ai WHERE ai.batch_id = b.id
                    ) as totalCount,
                    (
                        SELECT COUNT(*) FROM account_issuance_items ai WHERE ai.batch_id = b.id AND ai.can_download_password = 1
                    ) as downloadableCount
             FROM account_issuance_batches b
             LEFT JOIN users u ON u.id = b.operator_user_id
             ORDER BY b.created_at DESC, b.id DESC
             LIMIT 200`
        )
        .all() as Array<Record<string, unknown>>)
        .map((item) => repairRecordStrings(item));

    res.json({ success: true, message: "查询成功", data: rows });
});

authRouter.get("/account-issuance-batches/:batchId", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (req, res) => {
    const batchId = Number(req.params.batchId);
    if (Number.isNaN(batchId) || batchId <= 0) {
        res.status(400).json({ success: false, message: "批次ID不合法" });
        return;
    }

    const rawBatch = db
        .prepare(
            `SELECT b.id, b.batch_type as batchType, b.source_module as sourceModule, b.title, b.note, b.created_at as createdAt,
                    u.display_name as operatorName,
                    (
                        SELECT COUNT(*) FROM account_issuance_items ai WHERE ai.batch_id = b.id
                    ) as totalCount,
                    (
                        SELECT COUNT(*) FROM account_issuance_items ai WHERE ai.batch_id = b.id AND ai.can_download_password = 1
                    ) as downloadableCount
             FROM account_issuance_batches b
             LEFT JOIN users u ON u.id = b.operator_user_id
             WHERE b.id = ?`
        )
        .get(batchId) as Record<string, unknown> | undefined;
    const batch = rawBatch ? repairRecordStrings(rawBatch) : undefined;

    if (!batch) {
        res.status(404).json({ success: false, message: "账号发放批次不存在" });
        return;
    }

    const items = (db
        .prepare(
            `SELECT id, user_id as userId, username, display_name as displayName, role,
                    related_name as relatedName, student_no as studentNo, class_name as className,
                    subject_name as subjectName, can_download_password as canDownloadPassword,
                    invalidated_at as invalidatedAt, invalidation_reason as invalidationReason,
                    created_at as createdAt
             FROM account_issuance_items
             WHERE batch_id = ?
             ORDER BY id ASC`
        )
        .all(batchId) as Array<Record<string, unknown>>)
        .map((item) => repairRecordStrings(item));

    res.json({ success: true, message: "查询成功", data: { batch, items } });
});

authRouter.post("/account-issuance-batches/:batchId/download", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (req: AuthedRequest, res) => {
    const batchId = Number(req.params.batchId);
    if (Number.isNaN(batchId) || batchId <= 0) {
        res.status(400).json({ success: false, message: "批次ID不合法" });
        return;
    }

    const batch = db
        .prepare(`SELECT id, title FROM account_issuance_batches WHERE id = ?`)
        .get(batchId) as { id: number; title: string } | undefined;
    if (!batch) {
        res.status(404).json({ success: false, message: "账号发放批次不存在" });
        return;
    }

    const { items, skippedCount } = getDownloadableIssuanceItems(db, { batchId });
    if (items.length === 0) {
        res.status(400).json({ success: false, message: "该批次账号均已改密，当前没有可再次下载的密码" });
        return;
    }

    const buffer = buildIssuanceWorkbookBuffer(items, resolveLoginUrl(req));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(buildDownloadFilename(batch.title))}`);
    res.setHeader("X-Skipped-Count", String(skippedCount));
    res.end(buffer);
});

authRouter.post("/account-issuance-items/download", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (req: AuthedRequest, res) => {
    const parsed = selectedIssuanceItemsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const { items, skippedCount } = getDownloadableIssuanceItems(db, { itemIds: parsed.data.itemIds });
    if (items.length === 0) {
        res.status(400).json({ success: false, message: "选中的账号已全部改密，无法再次下载原始一次性密码" });
        return;
    }

    const buffer = buildIssuanceWorkbookBuffer(items, resolveLoginUrl(req));
    const title = `选中未改密账号 ${dayjs().format("YYYY-MM-DD HH:mm")}`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(buildDownloadFilename(title))}`);
    res.setHeader("X-Skipped-Count", String(skippedCount));
    res.end(buffer);
});

authRouter.get("/demo-accounts", requireAuth, requireRole(ROLES.ADMIN), (_req, res) => {
    if (isProduction) {
        res.status(404).json({ success: false, message: "生产环境不提供演示账号接口" });
        return;
    }
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
