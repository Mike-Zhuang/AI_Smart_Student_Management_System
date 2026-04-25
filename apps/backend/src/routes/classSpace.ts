import { Router, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";
import { normalizeClassName, repairRecordStrings } from "../utils/text.js";

export const classSpaceRouter = Router();

type AvailableClassOption = {
    className: string;
    label: string;
};

const getAccessibleClasses = (req: AuthedRequest): AvailableClassOption[] => {
    if (!req.user) {
        return [];
    }

    if (req.user.role === ROLES.ADMIN) {
        return (db.prepare(`SELECT DISTINCT class_name as className FROM students ORDER BY class_name ASC`).all() as Array<{ className: string }>)
            .map((item) => ({ className: item.className, label: item.className }));
    }

    if (req.user.role === ROLES.TEACHER || req.user.role === ROLES.HEAD_TEACHER) {
        return (db.prepare(
            `SELECT DISTINCT class_name as className
             FROM teacher_class_links
             WHERE teacher_user_id = ?
             ORDER BY class_name ASC`
        ).all(req.user.id) as Array<{ className: string }>)
            .map((item) => ({ className: item.className, label: item.className }));
    }

    if (req.user.role === ROLES.PARENT) {
        const rows = db.prepare(
            `SELECT DISTINCT s.class_name as className, s.name
             FROM parent_student_links psl
             JOIN students s ON s.id = psl.student_id
             WHERE psl.parent_user_id = ?
             ORDER BY s.class_name ASC, s.name ASC`
        ).all(req.user.id) as Array<{ className: string; name: string }>;

        const grouped = new Map<string, string[]>();
        rows.forEach((item) => {
            const current = grouped.get(item.className) ?? [];
            current.push(item.name);
            grouped.set(item.className, current);
        });

        return Array.from(grouped.entries()).map(([className, names]) => ({
            className,
            label: `${className}（${names.join("、")}）`
        }));
    }

    if (req.user.role === ROLES.STUDENT && req.user.linkedStudentId) {
        const row = db.prepare(
            `SELECT class_name as className
             FROM students
             WHERE id = ?`
        ).get(req.user.linkedStudentId) as { className: string } | undefined;
        return row ? [{ className: row.className, label: row.className }] : [];
    }

    return [];
};

const canAccessClass = (req: AuthedRequest, className: string): boolean => {
    const normalized = normalizeClassName(className);
    return getAccessibleClasses(req).some((item) => normalizeClassName(item.className) === normalized);
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const getFileKind = (filePath: unknown): "image" | "file" | null => {
    if (typeof filePath !== "string" || !filePath) {
        return null;
    }
    const extension = path.extname(filePath).toLowerCase();
    return IMAGE_EXTENSIONS.has(extension) ? "image" : "file";
};

const sendProtectedMedia = (
    req: AuthedRequest,
    res: Response,
    row: { className: string; filePath: string | null; fileName: string | null } | undefined
): void => {
    if (!row) {
        res.status(404).json({ success: false, message: "文件不存在" });
        return;
    }

    if (!canAccessClass(req, row.className)) {
        res.status(403).json({ success: false, message: "无权查看该班级文件" });
        return;
    }

    if (!row.filePath || !fs.existsSync(row.filePath)) {
        res.status(404).json({ success: false, message: "文件不存在或已被清理" });
        return;
    }

    if (getFileKind(row.filePath) === "image") {
        res.type(path.extname(row.filePath).toLowerCase() === ".webp" ? "image/webp" : path.extname(row.filePath));
    } else if (row.fileName) {
        res.attachment(row.fileName);
    }

    res.sendFile(row.filePath);
};

classSpaceRouter.use(requireAuth);

classSpaceRouter.get("/overview", (req: AuthedRequest, res) => {
    const availableClasses = getAccessibleClasses(req);
    res.json({
        success: true,
        message: "查询成功",
        data: {
            availableClasses,
            defaultClassName: availableClasses[0]?.className ?? ""
        }
    });
});

classSpaceRouter.get("/detail", (req: AuthedRequest, res) => {
    const requestedClassName = typeof req.query.className === "string" ? req.query.className : "";
    const className = normalizeClassName(requestedClassName || getAccessibleClasses(req)[0]?.className || "");

    if (!className) {
        res.status(404).json({ success: false, message: "当前账号暂无可查看的班级信息" });
        return;
    }

    if (!canAccessClass(req, className)) {
        res.status(403).json({ success: false, message: "无权查看该班级信息" });
        return;
    }

    const profile = db.prepare(
        `SELECT class_name as className, class_motto as classMotto, class_style as classStyle,
                class_slogan as classSlogan, course_schedule as courseSchedule,
                class_rules as classRules, seat_map as seatMap, class_committee as classCommittee,
                updated_at as updatedAt
         FROM class_profiles
         WHERE class_name = ?`
    ).get(className) as Record<string, unknown> | undefined;

    const roster = (db.prepare(
        `SELECT id, student_no as studentNo, name, grade, class_name as className
         FROM students
         WHERE class_name = ?
         ORDER BY student_no ASC, id ASC`
    ).all(className) as Array<Record<string, unknown>>).map((item) => repairRecordStrings(item));

    const wellbeingPosts = (db.prepare(
        `SELECT id, title, content, attachment_name as attachmentName, attachment_path as attachmentPath, created_at as createdAt
         FROM wellbeing_posts
         WHERE class_name = ?
         ORDER BY id DESC`
    ).all(className) as Array<Record<string, unknown>>).map((item) => {
        const repaired = repairRecordStrings(item);
        const mediaKind = getFileKind(repaired.attachmentPath);
        return {
            ...repaired,
            attachmentPath: undefined,
            attachmentKind: mediaKind,
            attachmentUrl: mediaKind ? `/api/class-space/media/wellbeing/${repaired.id}` : null
        };
    });

    const gallery = (db.prepare(
        `SELECT id, title, description, activity_date as activityDate, file_name as fileName, file_path as filePath, created_at as createdAt
         FROM class_gallery
         WHERE class_name = ?
         ORDER BY id DESC`
    ).all(className) as Array<Record<string, unknown>>).map((item) => {
        const repaired = repairRecordStrings(item);
        const mediaKind = getFileKind(repaired.filePath);
        return {
            ...repaired,
            filePath: undefined,
            fileKind: mediaKind,
            fileUrl: mediaKind ? `/api/class-space/media/gallery/${repaired.id}` : null
        };
    });

    res.json({
        success: true,
        message: "查询成功",
        data: {
            className,
            profile: profile ? repairRecordStrings(profile) : null,
            roster,
            wellbeingPosts,
            gallery
        }
    });
});

classSpaceRouter.get("/media/wellbeing/:id", (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const row = db
        .prepare(`SELECT class_name as className, attachment_path as filePath, attachment_name as fileName FROM wellbeing_posts WHERE id = ?`)
        .get(id) as { className: string; filePath: string | null; fileName: string | null } | undefined;
    sendProtectedMedia(req, res, row);
});

classSpaceRouter.get("/media/gallery/:id", (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const row = db
        .prepare(`SELECT class_name as className, file_path as filePath, file_name as fileName FROM class_gallery WHERE id = ?`)
        .get(id) as { className: string; filePath: string | null; fileName: string | null } | undefined;
    sendProtectedMedia(req, res, row);
});
