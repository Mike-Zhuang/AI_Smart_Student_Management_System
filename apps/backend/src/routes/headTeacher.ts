import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dayjs from "dayjs";
import multer from "multer";
import sharp from "sharp";
import { Router, type Response } from "express";
import { z } from "zod";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { uploadRateLimit } from "../middleware/rateLimit.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";
import { assertSafeBusinessText } from "../utils/contentSafety.js";
import { assertSafeUploadFile, createMulterFileSizeLimit } from "../utils/fileSecurity.js";
import { normalizeClassName, repairText } from "../utils/text.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, "../../data/uploads/head-teacher");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: createMulterFileSizeLimit() }
});

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const getFileKind = (filePath: unknown): "image" | "file" | null => {
    if (typeof filePath !== "string" || !filePath) {
        return null;
    }
    return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ? "image" : "file";
};

const classProfileSchema = z.object({
    className: z.string().min(2),
    classMotto: z.string().optional(),
    classStyle: z.string().optional(),
    classSlogan: z.string().optional(),
    courseSchedule: z.string().optional(),
    classRules: z.string().optional(),
    seatMap: z.string().optional(),
    classCommittee: z.string().optional()
});

const classLogSchema = z.object({
    className: z.string().min(2),
    studentId: z.number().int().positive().optional().nullable(),
    studentName: z.string().optional(),
    category: z.string().min(2),
    title: z.string().min(2),
    content: z.string().min(2),
    recordDate: z.string().min(8)
});

const wellbeingSchema = z.object({
    className: z.string().min(2),
    title: z.string().min(2),
    content: z.string().min(2)
});

const scoreSchema = z.object({
    className: z.string().min(2),
    groupName: z.string().min(2),
    activityName: z.string().min(2),
    scoreDelta: z.number().min(-50).max(50),
    note: z.string().optional()
});

const gallerySchema = z.object({
    className: z.string().min(2),
    title: z.string().min(2),
    description: z.string().optional(),
    activityDate: z.string().optional()
});

const deleteBatchSchema = z.object({
    ids: z.array(z.number().int().positive()).min(1)
});

export const headTeacherRouter = Router();

const getAvailableClasses = (user: NonNullable<AuthedRequest["user"]>): string[] => {
    if (user.role === ROLES.ADMIN) {
        return (db.prepare("SELECT DISTINCT class_name as className FROM students ORDER BY class_name").all() as Array<{ className: string }>)
            .map((item) => item.className);
    }

    return (db
        .prepare(
            `SELECT class_name as className
             FROM teacher_class_links
             WHERE teacher_user_id = ? AND is_head_teacher = 1
             ORDER BY class_name`
        )
        .all(user.id) as Array<{ className: string }>).map((item) => item.className);
};

const assertClassAccess = (req: AuthedRequest, className: string, res: Response): boolean => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return false;
    }

    const normalizedClassName = normalizeClassName(className);
    const classes = getAvailableClasses(req.user);
    if (!classes.includes(normalizedClassName)) {
        res.status(403).json({ success: false, message: "无权访问该班级数据" });
        return false;
    }

    return true;
};

const saveUpload = async (
    file: Express.Multer.File | undefined,
    prefix: string,
    category: "wellbeing-attachment" | "gallery-image"
): Promise<{ fileName: string | null; filePath: string | null }> => {
    if (!file) {
        return { fileName: null, filePath: null };
    }

    const safeUpload = assertSafeUploadFile(file, category);
    const extension = safeUpload.extension || ".dat";
    const safePrefix = prefix.replace(/[\\/:*?"<>|\s]+/g, "-");
    const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
    const shouldCompressImage = imageExtensions.has(extension);
    const finalExtension = shouldCompressImage ? ".webp" : extension;
    const safeName = `${safePrefix}-${Date.now()}${finalExtension}`;
    const absolutePath = path.join(uploadDir, safeName);

    if (shouldCompressImage) {
        await sharp(file.buffer)
            .rotate()
            .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 86, effort: 4 })
            .toFile(absolutePath);

        return {
            fileName: repairText(safeUpload.sanitizedName),
            filePath: absolutePath
        };
    }

    fs.writeFileSync(absolutePath, file.buffer);
    return {
        fileName: repairText(safeUpload.sanitizedName),
        filePath: absolutePath
    };
};

headTeacherRouter.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.HEAD_TEACHER));

headTeacherRouter.get("/workbench", (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const availableClasses = getAvailableClasses(req.user);
    const className = normalizeClassName(typeof req.query.className === "string" ? req.query.className : availableClasses[0] ?? "");
    if (!className) {
        res.status(404).json({ success: false, message: "未找到班级数据" });
        return;
    }

    if (!assertClassAccess(req, className, res)) {
        return;
    }

    const pendingLeaves = db
        .prepare(
            `SELECT COUNT(*) as count
             FROM leave_requests lr
             JOIN students s ON s.id = lr.student_id
             WHERE s.class_name = ? AND lr.status IN ('pending_parent_confirm', 'pending_head_teacher_review')`
        )
        .get(className) as { count: number };

    const openAlerts = db
        .prepare(
            `SELECT COUNT(*) as count
             FROM alerts a
             JOIN students s ON s.id = a.student_id
             WHERE s.class_name = ? AND a.status = 'open'`
        )
        .get(className) as { count: number };

    const unreadParentMessages = db
        .prepare(
            `SELECT COUNT(*) as count
             FROM messages m
             WHERE m.receiver_role = ? AND m.is_read = 0`
        )
        .get(ROLES.PARENT) as { count: number };

    const classLogsToday = db
        .prepare(
            `SELECT COUNT(*) as count
             FROM class_logs
             WHERE class_name = ? AND record_date = ?`
        )
        .get(className, dayjs().format("YYYY-MM-DD")) as { count: number };

    const riskStudents = db
        .prepare(
            `SELECT s.id, s.name, s.class_name as className, gp.risk_level as riskLevel, gp.summary,
                    ROUND(AVG(er.score), 1) as avgScore
             FROM students s
             JOIN growth_profiles gp ON gp.student_id = s.id
             LEFT JOIN exam_results er ON er.student_id = s.id
             WHERE s.class_name = ? AND gp.risk_level != 'low'
             GROUP BY s.id, s.name, s.class_name, gp.risk_level, gp.summary
             ORDER BY CASE gp.risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, avgScore ASC
             LIMIT 20`
        )
        .all(className);

    const recentActions = db
        .prepare(
            `SELECT a.id, a.action_module as actionModule, a.action_type as actionType, a.object_type as objectType,
                    a.created_at as createdAt, u.display_name as operatorName
             FROM audit_logs a
             LEFT JOIN users u ON u.id = a.user_id
             WHERE a.action_module IN ('home-school', 'growth', 'head-teacher', 'students')
             ORDER BY a.created_at DESC
             LIMIT 8`
        )
        .all();

    const scoreBoard = db
        .prepare(
            `SELECT group_name as groupName, ROUND(SUM(score_delta), 1) as totalScore
             FROM group_score_records
             WHERE class_name = ?
             GROUP BY group_name
             ORDER BY totalScore DESC, group_name ASC`
        )
        .all(className);

    res.json({
        success: true,
        message: "查询成功",
        data: {
            className,
            availableClasses,
            todoFunnel: [
                { stage: "待处理请假", count: pendingLeaves.count },
                { stage: "待跟进预警", count: openAlerts.count },
                { stage: "今日班级日志", count: classLogsToday.count },
                { stage: "待家长回执", count: unreadParentMessages.count }
            ],
            riskStudents,
            scoreBoard,
            recentActions
        }
    });
});

headTeacherRouter.get("/class-profile", (req: AuthedRequest, res) => {
    const requestedClass = typeof req.query.className === "string" ? req.query.className : "";
    const className = normalizeClassName(requestedClass);
    if (!className || !assertClassAccess(req, className, res)) {
        return;
    }

    const profile = db
        .prepare(
            `SELECT class_name as className, class_motto as classMotto, class_style as classStyle,
                    class_slogan as classSlogan, course_schedule as courseSchedule,
                    class_rules as classRules, seat_map as seatMap, class_committee as classCommittee,
                    updated_at as updatedAt
             FROM class_profiles
             WHERE class_name = ?`
        )
        .get(className);

    const roster = db
        .prepare(
            `SELECT id, student_no as studentNo, name, grade, class_name as className
             FROM students
             WHERE class_name = ?
             ORDER BY id ASC`
        )
        .all(className);

    res.json({ success: true, message: "查询成功", data: { profile, roster } });
});

headTeacherRouter.patch("/class-profile", (req: AuthedRequest, res) => {
    const parsed = classProfileSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const input = parsed.data;
    const className = normalizeClassName(input.className);
    if (!assertClassAccess(req, className, res)) {
        return;
    }

    db.prepare(
        `INSERT INTO class_profiles (
            class_name, class_motto, class_style, class_slogan, course_schedule,
            class_rules, seat_map, class_committee, updated_by, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(class_name) DO UPDATE SET
            class_motto = excluded.class_motto,
            class_style = excluded.class_style,
            class_slogan = excluded.class_slogan,
            course_schedule = excluded.course_schedule,
            class_rules = excluded.class_rules,
            seat_map = excluded.seat_map,
            class_committee = excluded.class_committee,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`
    ).run(
        className,
        assertSafeBusinessText(input.classMotto ?? "", { fieldName: "班级格言", maxLength: 120 }),
        assertSafeBusinessText(input.classStyle ?? "", { fieldName: "班风", maxLength: 200 }),
        assertSafeBusinessText(input.classSlogan ?? "", { fieldName: "班级口号", maxLength: 120 }),
        assertSafeBusinessText(input.courseSchedule ?? "", { fieldName: "课程表", maxLength: 2000 }),
        assertSafeBusinessText(input.classRules ?? "", { fieldName: "班级公约", maxLength: 2000 }),
        assertSafeBusinessText(input.seatMap ?? "", { fieldName: "座位表", maxLength: 2000 }),
        assertSafeBusinessText(input.classCommittee ?? "", { fieldName: "班委会", maxLength: 2000 }),
        req.user.id,
        dayjs().toISOString()
    );

    logAudit({
        userId: req.user.id,
        actionModule: "head-teacher",
        actionType: "class_profile_update",
        objectType: "class_profile",
        detail: { className },
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: "班级简介已更新" });
});

headTeacherRouter.get("/class-logs", (req: AuthedRequest, res) => {
    const className = normalizeClassName(typeof req.query.className === "string" ? req.query.className : "");
    if (!className || !assertClassAccess(req, className, res)) {
        return;
    }

    const rows = db
        .prepare(
            `SELECT id, class_name as className, student_id as studentId, student_name as studentName, category,
                    title, content, record_date as recordDate, created_at as createdAt
             FROM class_logs
             WHERE class_name = ?
             ORDER BY record_date DESC, id DESC`
        )
        .all(className);

    res.json({ success: true, message: "查询成功", data: rows });
});

headTeacherRouter.post("/class-logs", (req: AuthedRequest, res) => {
    const parsed = classLogSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const input = parsed.data;
    const className = normalizeClassName(input.className);
    if (!assertClassAccess(req, className, res)) {
        return;
    }

    db.prepare(
        `INSERT INTO class_logs (class_name, student_id, student_name, category, title, content, record_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        className,
        input.studentId ?? null,
        repairText(input.studentName ?? ""),
        assertSafeBusinessText(input.category, { fieldName: "日志分类", required: true, maxLength: 60 }),
        assertSafeBusinessText(input.title, { fieldName: "日志标题", required: true, maxLength: 120 }),
        assertSafeBusinessText(input.content, { fieldName: "日志内容", required: true, maxLength: 2000 }),
        input.recordDate,
        req.user.id,
        dayjs().toISOString()
    );

    res.json({ success: true, message: "班级日志已新增" });
});

headTeacherRouter.delete("/class-logs/:id", (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id) || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const row = db.prepare("SELECT class_name as className FROM class_logs WHERE id = ?").get(id) as { className: string } | undefined;
    if (!row) {
        res.status(404).json({ success: false, message: "班级日志不存在" });
        return;
    }
    if (!assertClassAccess(req, row.className, res)) {
        return;
    }

    db.prepare("DELETE FROM class_logs WHERE id = ?").run(id);
    res.json({ success: true, message: "班级日志已删除" });
});

headTeacherRouter.get("/wellbeing-posts", (req: AuthedRequest, res) => {
    const className = normalizeClassName(typeof req.query.className === "string" ? req.query.className : "");
    if (!className || !assertClassAccess(req, className, res)) {
        return;
    }

    const rows = db
        .prepare(
            `SELECT id, class_name as className, title, content, attachment_name as attachmentName, attachment_path as attachmentPath, created_at as createdAt
             FROM wellbeing_posts
             WHERE class_name = ?
             ORDER BY id DESC`
        )
        .all(className) as Array<Record<string, unknown>>;

    res.json({
        success: true,
        message: "查询成功",
        data: rows.map((item) => {
            const mediaKind = getFileKind(item.attachmentPath);
            return {
                ...item,
                attachmentPath: undefined,
                attachmentKind: mediaKind,
                attachmentUrl: mediaKind ? `/api/class-space/media/wellbeing/${item.id}` : null
            };
        })
    });
});

headTeacherRouter.post("/wellbeing-posts", uploadRateLimit, upload.single("file"), async (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const parsed = wellbeingSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const className = normalizeClassName(parsed.data.className);
    if (!assertClassAccess(req, className, res)) {
        return;
    }

    let uploadResult;
    try {
        uploadResult = await saveUpload(req.file, `wellbeing-${className}`, "wellbeing-attachment");
    } catch (error) {
        res.status(400).json({ success: false, message: error instanceof Error ? error.message : "附件校验失败" });
        return;
    }
    db.prepare(
        `INSERT INTO wellbeing_posts (class_name, title, content, attachment_name, attachment_path, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
        className,
        assertSafeBusinessText(parsed.data.title, { fieldName: "心灵驿站标题", required: true, maxLength: 120 }),
        assertSafeBusinessText(parsed.data.content, { fieldName: "心灵驿站内容", required: true, maxLength: 2000 }),
        uploadResult.fileName,
        uploadResult.filePath,
        req.user.id,
        dayjs().toISOString()
    );

    res.json({ success: true, message: "心灵驿站内容已发布" });
});

headTeacherRouter.delete("/wellbeing-posts/:id", (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const row = db
        .prepare("SELECT class_name as className, attachment_path as attachmentPath FROM wellbeing_posts WHERE id = ?")
        .get(id) as { className: string; attachmentPath: string | null } | undefined;
    if (!row) {
        res.status(404).json({ success: false, message: "内容不存在" });
        return;
    }
    if (!assertClassAccess(req, row.className, res)) {
        return;
    }

    db.prepare("DELETE FROM wellbeing_posts WHERE id = ?").run(id);
    if (row.attachmentPath && fs.existsSync(row.attachmentPath)) {
        fs.unlinkSync(row.attachmentPath);
    }
    res.json({ success: true, message: "心灵驿站内容已删除" });
});

headTeacherRouter.get("/group-score-records", (req: AuthedRequest, res) => {
    const className = normalizeClassName(typeof req.query.className === "string" ? req.query.className : "");
    if (!className || !assertClassAccess(req, className, res)) {
        return;
    }

    const records = db
        .prepare(
            `SELECT id, class_name as className, group_name as groupName, activity_name as activityName,
                    score_delta as scoreDelta, note, created_at as createdAt
             FROM group_score_records
             WHERE class_name = ?
             ORDER BY id DESC`
        )
        .all(className);

    const scoreBoard = db
        .prepare(
            `SELECT group_name as groupName, ROUND(SUM(score_delta), 1) as totalScore
             FROM group_score_records
             WHERE class_name = ?
             GROUP BY group_name
             ORDER BY totalScore DESC, group_name ASC`
        )
        .all(className);

    res.json({ success: true, message: "查询成功", data: { records, scoreBoard } });
});

headTeacherRouter.post("/group-score-records", (req: AuthedRequest, res) => {
    const parsed = scoreSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const input = parsed.data;
    const className = normalizeClassName(input.className);
    if (!assertClassAccess(req, className, res)) {
        return;
    }

    db.prepare(
        `INSERT OR IGNORE INTO student_groups (class_name, group_name, leader_name, created_at)
         VALUES (?, ?, NULL, ?)`
    ).run(className, repairText(input.groupName), dayjs().toISOString());

    db.prepare(
        `INSERT INTO group_score_records (class_name, group_name, activity_name, score_delta, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
        className,
        assertSafeBusinessText(input.groupName, { fieldName: "小组名称", required: true, maxLength: 60 }),
        assertSafeBusinessText(input.activityName, { fieldName: "活动名称", required: true, maxLength: 120 }),
        input.scoreDelta,
        assertSafeBusinessText(input.note ?? "", { fieldName: "备注", maxLength: 300 }),
        req.user.id,
        dayjs().toISOString()
    );

    res.json({ success: true, message: "小组积分已记录" });
});

headTeacherRouter.delete("/group-score-records/:id", (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const row = db.prepare("SELECT class_name as className FROM group_score_records WHERE id = ?").get(id) as { className: string } | undefined;
    if (!row) {
        res.status(404).json({ success: false, message: "积分记录不存在" });
        return;
    }
    if (!assertClassAccess(req, row.className, res)) {
        return;
    }

    db.prepare("DELETE FROM group_score_records WHERE id = ?").run(id);
    res.json({ success: true, message: "积分记录已删除" });
});

headTeacherRouter.get("/gallery", (req: AuthedRequest, res) => {
    const className = normalizeClassName(typeof req.query.className === "string" ? req.query.className : "");
    if (!className || !assertClassAccess(req, className, res)) {
        return;
    }

    const rows = db
        .prepare(
            `SELECT id, class_name as className, title, description, activity_date as activityDate,
                    file_name as fileName, file_path as filePath, created_at as createdAt
             FROM class_gallery
             WHERE class_name = ?
             ORDER BY id DESC`
        )
        .all(className) as Array<Record<string, unknown>>;

    res.json({
        success: true,
        message: "查询成功",
        data: rows.map((item) => {
            const mediaKind = getFileKind(item.filePath);
            return {
                ...item,
                filePath: undefined,
                fileKind: mediaKind,
                fileUrl: mediaKind ? `/api/class-space/media/gallery/${item.id}` : null
            };
        })
    });
});

headTeacherRouter.post("/gallery", uploadRateLimit, upload.single("file"), async (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const parsed = gallerySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const className = normalizeClassName(parsed.data.className);
    if (!assertClassAccess(req, className, res)) {
        return;
    }

    let uploadResult;
    try {
        uploadResult = await saveUpload(req.file, `gallery-${className}`, "gallery-image");
    } catch (error) {
        res.status(400).json({ success: false, message: error instanceof Error ? error.message : "图片校验失败" });
        return;
    }
    db.prepare(
        `INSERT INTO class_gallery (class_name, title, description, activity_date, file_name, file_path, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        className,
        assertSafeBusinessText(parsed.data.title, { fieldName: "风采标题", required: true, maxLength: 120 }),
        assertSafeBusinessText(parsed.data.description ?? "", { fieldName: "风采描述", maxLength: 1000 }),
        parsed.data.activityDate ?? null,
        uploadResult.fileName,
        uploadResult.filePath,
        req.user.id,
        dayjs().toISOString()
    );

    res.json({ success: true, message: "班级风采已新增" });
});

headTeacherRouter.delete("/gallery/:id", (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const row = db
        .prepare("SELECT class_name as className, file_path as filePath FROM class_gallery WHERE id = ?")
        .get(id) as { className: string; filePath: string | null } | undefined;
    if (!row) {
        res.status(404).json({ success: false, message: "风采记录不存在" });
        return;
    }
    if (!assertClassAccess(req, row.className, res)) {
        return;
    }

    db.prepare("DELETE FROM class_gallery WHERE id = ?").run(id);
    if (row.filePath && fs.existsSync(row.filePath)) {
        fs.unlinkSync(row.filePath);
    }
    res.json({ success: true, message: "班级风采已删除" });
});

headTeacherRouter.post("/class-logs/batch-delete", (req: AuthedRequest, res) => {
    const parsed = deleteBatchSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const rows = db
        .prepare(`SELECT DISTINCT class_name as className FROM class_logs WHERE id IN (${parsed.data.ids.map(() => "?").join(",")})`)
        .all(...parsed.data.ids) as Array<{ className: string }>;

    if (rows.some((row) => !assertClassAccess(req, row.className, res))) {
        return;
    }

    db.prepare(`DELETE FROM class_logs WHERE id IN (${parsed.data.ids.map(() => "?").join(",")})`).run(...parsed.data.ids);
    res.json({ success: true, message: `已删除 ${parsed.data.ids.length} 条班级日志` });
});
