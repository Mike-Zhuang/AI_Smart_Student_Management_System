import { Router } from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { db } from "../db.js";
import { ROLES } from "../constants.js";
import { canAccessStudent, requireAuth, requireRole } from "../middleware/auth.js";
import {
    buildIssuanceWorkbookBuffer,
    createIssuanceBatch,
    getDownloadableIssuanceItems,
    invalidateUserIssuancePasswords
} from "../utils/accountIssuance.js";
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

    const desiredUsername = input.username?.trim() || buildParentUsername(student.studentNo);
    const username = findAvailableUsername(desiredUsername);
    const temporaryPassword = generateTemporaryPassword();
    const createdAt = dayjs().toISOString();
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
        input.displayName.trim(),
        hashPassword(temporaryPassword),
        ROLES.PARENT,
        input.phone?.trim() || null,
        createdAt,
        createdAt
    );

    const parentUserId = Number(result.lastInsertRowid);
    db.prepare(
        `INSERT OR IGNORE INTO parent_student_links (parent_user_id, student_id, relation, created_at)
         VALUES (?, ?, ?, ?)`
    ).run(parentUserId, student.id, input.relation.trim(), createdAt);
    db.prepare(`UPDATE students SET parent_user_id = COALESCE(parent_user_id, ?) WHERE id = ?`).run(parentUserId, student.id);

    const issuanceBatchId = createIssuanceBatch(db, {
        batchType: "parent_account_create",
        sourceModule: "auth",
        operatorUserId: input.operatorUserId,
        title: `家长账号发放 ${student.name} ${dayjs().format("YYYY-MM-DD HH:mm")}`,
        note: `${input.displayName.trim()} 已绑定 ${student.name}`,
        items: [
            {
                userId: parentUserId,
                username,
                temporaryPassword,
                displayName: input.displayName.trim(),
                role: ROLES.PARENT,
                relatedName: `${student.name} / ${student.studentNo} / ${student.className}`,
                studentNo: student.studentNo,
                className: student.className
            }
        ]
    });

    return { userId: parentUserId, username, issuanceBatchId };
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
    invalidateUserIssuancePasswords(db, req.user.id);

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
             ORDER BY u.created_at DESC
             LIMIT 400`
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
    invalidateUserIssuancePasswords(db, target.id, "admin_reset_password");
    db.prepare(
        `UPDATE users
         SET password_hash = ?, must_change_password = 1, password_reset_at = ?, is_active = 1
         WHERE id = ?`
    ).run(hashPassword(temporaryPassword), dayjs().toISOString(), target.id);
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
    const rows = db
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
        .all();

    res.json({ success: true, message: "查询成功", data: rows });
});

authRouter.get("/account-issuance-batches/:batchId", requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER, ROLES.HEAD_TEACHER), (req, res) => {
    const batchId = Number(req.params.batchId);
    if (Number.isNaN(batchId) || batchId <= 0) {
        res.status(400).json({ success: false, message: "批次ID不合法" });
        return;
    }

    const batch = db
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
        .get(batchId);

    if (!batch) {
        res.status(404).json({ success: false, message: "账号发放批次不存在" });
        return;
    }

    const items = db
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
        .all(batchId);

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
