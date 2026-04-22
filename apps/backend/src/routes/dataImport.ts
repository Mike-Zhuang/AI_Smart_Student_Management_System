import { Router } from "express";
import type { NextFunction, Response } from "express";
import dayjs from "dayjs";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "node:url";
import path from "node:path";
import multer from "multer";
import XLSX from "xlsx";
import { z } from "zod";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";
import { createIssuanceBatch } from "../utils/accountIssuance.js";
import { deleteUserWithIssuance } from "../utils/accountMaintenance.js";
import { extractIp, logAudit } from "../utils/audit.js";
import { generateTemporaryPassword, hashPassword } from "../utils/auth.js";
import { decodeTextBuffer, normalizeClassName, normalizeExamName, normalizeName, repairRecordStrings, repairText } from "../utils/text.js";

type SheetRecord = Record<string, unknown>;

type ImportErrorItem = {
    line: number;
    field: string;
    reason: string;
};

type AccountIssueRecord = {
    userId: number;
    username: string;
    temporaryPassword: string;
    displayName: string;
    role: string;
    relatedName: string;
    studentNo?: string | null;
    className?: string | null;
    subjectName?: string | null;
};

type ImportSummary = {
    total: number;
    imported: number;
    updated: number;
    ignored: number;
    failed: number;
    errors: ImportErrorItem[];
    accountCreated: number;
    accountUpdated: number;
    accountExisting: number;
    issuanceRecords: AccountIssueRecord[];
    issuanceBatchId?: number | null;
};

type StudentImportRow = {
    studentNo: string;
    name: string;
    grade: string;
    className: string;
    subjectCombination?: string;
    interests?: string;
    careerGoal?: string;
    loginUsername?: string;
    displayName?: string;
};

type ExamImportRow = {
    studentNo: string;
    examName: string;
    examDate: string;
    subject: string;
    score: number;
};

type TeacherImportRow = {
    teacherUsername: string;
    displayName: string;
    className: string;
    isHeadTeacher: number;
    subjectName?: string;
};

type AccountSyncResult = "created" | "updated" | "existing";

const studentRowSchema = z.object({
    studentNo: z.string().min(4, "学号长度至少4位"),
    name: z.string().min(2, "姓名长度至少2位"),
    grade: z.string().min(2, "年级不能为空"),
    className: z.string().min(2, "班级不能为空"),
    subjectCombination: z.string().optional(),
    interests: z.string().optional(),
    careerGoal: z.string().optional(),
    loginUsername: z.string().min(4, "登录账号长度至少4位").optional(),
    displayName: z.string().min(2, "显示名长度至少2位").optional()
});

const examRowSchema = z.object({
    studentNo: z.string().min(4, "学号长度至少4位"),
    examName: z.string().min(2, "考试名称不能为空"),
    examDate: z.string().min(8, "考试日期格式错误"),
    subject: z.string().min(2, "科目不能为空"),
    score: z.number().min(0, "分数不能小于0").max(100, "分数不能大于100")
});

const teacherRowSchema = z.object({
    teacherUsername: z.string().min(2, "教师登录账号不能为空"),
    displayName: z.string().min(2, "教师姓名不能为空"),
    className: z.string().min(2, "班级不能为空"),
    subjectName: z.string().optional()
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const mime = file.mimetype.toLowerCase();
        const filename = file.originalname.toLowerCase();
        const isCsvMime = ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"].includes(mime);
        const isXlsxMime = [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/octet-stream",
            "application/zip"
        ].includes(mime);
        const isCsvName = filename.endsWith(".csv");
        const isXlsxName = filename.endsWith(".xlsx");
        if ((!isCsvMime && !isCsvName) && (!isXlsxMime && !isXlsxName)) {
            callback(new Error("仅支持 CSV 或 XLSX 文件上传"));
            return;
        }
        callback(null, true);
    }
});

export const dataImportRouter = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateDir = path.resolve(__dirname, "../../templates");

const uploadSheet = (req: AuthedRequest, res: Response, next: NextFunction): void => {
    upload.single("file")(req, res, (error: unknown) => {
        if (!error) {
            next();
            return;
        }

        if (error instanceof multer.MulterError) {
            if (error.code === "LIMIT_FILE_SIZE") {
                res.status(400).json({ success: false, message: "上传文件过大，最大支持8MB" });
                return;
            }
            res.status(400).json({ success: false, message: "文件上传失败，请检查表格格式" });
            return;
        }

        const message = error instanceof Error ? error.message : "文件上传失败";
        res.status(400).json({ success: false, message });
    });
};

const cleanCell = (value: unknown): string => {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/^\uFEFF/, "")
        .replace(/\u00A0/g, " ")
        .replace(/\r/g, "")
        .trim();
};

const normalizeRecord = (record: SheetRecord): SheetRecord => {
    const normalized: SheetRecord = {};
    for (const [rawKey, rawValue] of Object.entries(record)) {
        const key = cleanCell(rawKey);
        normalized[key] = typeof rawValue === "string" ? cleanCell(rawValue) : rawValue;
    }
    return normalized;
};

const decodeCsvBuffer = (buffer: Buffer): string => {
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.toString("utf-8");
    }

    return decodeTextBuffer(buffer);
};

const parseCsvRows = (buffer: Buffer): SheetRecord[] => {
    const text = decodeCsvBuffer(buffer);
    const rows = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true
    }) as SheetRecord[];
    return rows.map(normalizeRecord);
};

const parseXlsxRows = (buffer: Buffer): SheetRecord[] => {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
    if (!worksheet) {
        return [];
    }

    const rows = XLSX.utils.sheet_to_json<SheetRecord>(worksheet, {
        defval: "",
        raw: false
    });
    return rows.map(normalizeRecord);
};

const tryParseJsonRows = (value: unknown): SheetRecord[] | null => {
    if (Array.isArray(value)) {
        return value.map((item) => (item && typeof item === "object" ? normalizeRecord(item as SheetRecord) : {}));
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value) as unknown;
            if (!Array.isArray(parsed)) {
                return null;
            }
            return parsed.map((item) => (item && typeof item === "object" ? normalizeRecord(item as SheetRecord) : {}));
        } catch {
            return null;
        }
    }

    return null;
};

const resolveRows = (req: AuthedRequest): { rows: SheetRecord[]; lineOffset: number; source: "csv" | "xlsx" | "json" } | null => {
    if (req.file) {
        try {
            const filename = req.file.originalname.toLowerCase();
            const isXlsx = filename.endsWith(".xlsx");
            return {
                rows: isXlsx ? parseXlsxRows(req.file.buffer) : parseCsvRows(req.file.buffer),
                lineOffset: 2,
                source: isXlsx ? "xlsx" : "csv"
            };
        } catch {
            return null;
        }
    }

    const rows = tryParseJsonRows(req.body?.rows);
    if (!rows) {
        return null;
    }

    return { rows, lineOffset: 1, source: "json" };
};

const pickValue = (row: SheetRecord, aliases: string[]): unknown => {
    for (const alias of aliases) {
        if (Object.prototype.hasOwnProperty.call(row, alias)) {
            return row[alias];
        }
    }
    return undefined;
};

const toRequiredString = (value: unknown): string => repairText(cleanCell(value));

const toOptionalString = (value: unknown): string | undefined => {
    const text = toRequiredString(value);
    return text.length > 0 ? text : undefined;
};

const appendZodErrors = (target: ImportErrorItem[], line: number, error: z.ZodError): void => {
    for (const issue of error.issues) {
        const field = issue.path.length > 0 ? String(issue.path[0]) : "row";
        target.push({ line, field, reason: issue.message });
    }
};

const parseStudentRow = (row: SheetRecord, line: number, errors: ImportErrorItem[]): StudentImportRow | null => {
    const candidate = {
        studentNo: toRequiredString(pickValue(row, ["studentNo", "student_no", "学号"])),
        name: normalizeName(pickValue(row, ["name", "姓名"])),
        grade: toRequiredString(pickValue(row, ["grade", "年级"])),
        className: normalizeClassName(pickValue(row, ["className", "class_name", "班级"])),
        subjectCombination: toOptionalString(pickValue(row, ["subjectCombination", "subject_combination", "选科组合"])),
        interests: toOptionalString(pickValue(row, ["interests", "兴趣"])),
        careerGoal: toOptionalString(pickValue(row, ["careerGoal", "career_goal", "职业目标"])),
        loginUsername: toOptionalString(pickValue(row, ["loginUsername", "username", "登录账号"])),
        displayName: toOptionalString(pickValue(row, ["displayName", "显示名"]))
    };

    const parsed = studentRowSchema.safeParse(candidate);
    if (!parsed.success) {
        appendZodErrors(errors, line, parsed.error);
        return null;
    }

    return parsed.data;
};

const parseExamRow = (row: SheetRecord, line: number, errors: ImportErrorItem[]): ExamImportRow | null => {
    const scoreRaw = pickValue(row, ["score", "分数"]);
    const score = typeof scoreRaw === "number" ? scoreRaw : Number(toRequiredString(scoreRaw));

    const candidate = {
        studentNo: toRequiredString(pickValue(row, ["studentNo", "student_no", "学号"])),
        examName: normalizeExamName(pickValue(row, ["examName", "exam_name", "考试名称"])),
        examDate: toRequiredString(pickValue(row, ["examDate", "exam_date", "考试日期"])),
        subject: toRequiredString(pickValue(row, ["subject", "科目"])),
        score
    };

    const parsed = examRowSchema.safeParse(candidate);
    if (!parsed.success) {
        appendZodErrors(errors, line, parsed.error);
        return null;
    }

    return parsed.data;
};

const parseHeadTeacherFlag = (value: unknown): number | null => {
    if (typeof value === "number") {
        return value === 1 ? 1 : value === 0 ? 0 : null;
    }

    const text = toRequiredString(value).toLowerCase();
    if (["1", "true", "yes", "y", "是", "班主任"].includes(text)) {
        return 1;
    }
    if (["0", "false", "no", "n", "否", "任课"].includes(text)) {
        return 0;
    }
    return null;
};

const parseTeacherRow = (row: SheetRecord, line: number, errors: ImportErrorItem[]): TeacherImportRow | null => {
    const flag = parseHeadTeacherFlag(pickValue(row, ["isHeadTeacher", "is_head_teacher", "是否班主任"]));
    if (flag === null) {
        errors.push({ line, field: "isHeadTeacher", reason: "是否班主任仅支持0/1或true/false" });
        return null;
    }

    const candidate = {
        teacherUsername: toRequiredString(pickValue(row, ["teacherUsername", "teacher_username", "登录账号", "教师账号"])),
        displayName: normalizeName(pickValue(row, ["displayName", "teacherName", "name", "教师姓名", "姓名"])),
        className: normalizeClassName(pickValue(row, ["className", "class_name", "班级"])),
        subjectName: toOptionalString(pickValue(row, ["subjectName", "subject_name", "任教学科"]))
    };

    const parsed = teacherRowSchema.safeParse(candidate);
    if (!parsed.success) {
        appendZodErrors(errors, line, parsed.error);
        return null;
    }

    return {
        ...parsed.data,
        isHeadTeacher: flag
    };
};

const buildSummary = (total: number): ImportSummary => ({
    total,
    imported: 0,
    updated: 0,
    ignored: 0,
    failed: 0,
    errors: [],
    accountCreated: 0,
    accountUpdated: 0,
    accountExisting: 0,
    issuanceRecords: []
});

const calcFailedLineCount = (errors: ImportErrorItem[]): number => new Set(errors.map((item) => item.line)).size;

const recordAccountSync = (summary: ImportSummary, result: AccountSyncResult): void => {
    if (result === "created") {
        summary.accountCreated += 1;
        return;
    }
    if (result === "updated") {
        summary.accountUpdated += 1;
        return;
    }
    summary.accountExisting += 1;
};

const syncStudentAccount = (row: StudentImportRow, studentId: number, summary: ImportSummary): void => {
    const username = row.loginUsername ?? row.studentNo;
    const displayName = row.displayName ?? row.name;
    const existing = db
        .prepare(
            `SELECT id, display_name as displayName, role, linked_student_id as linkedStudentId
             FROM users
             WHERE username = ?`
        )
        .get(username) as
        | { id: number; displayName: string; role: string; linkedStudentId: number | null }
        | undefined;

    if (!existing) {
        const temporaryPassword = generateTemporaryPassword();
        const result = db.prepare(
            `INSERT INTO users (
                username,
                display_name,
                password_hash,
                role,
                linked_student_id,
                must_change_password,
                password_reset_at,
                is_active,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?)`
        ).run(
            username,
            displayName,
            hashPassword(temporaryPassword),
            ROLES.STUDENT,
            studentId,
            dayjs().toISOString(),
            dayjs().toISOString()
        );
        const userId = Number(result.lastInsertRowid);

        summary.issuanceRecords.push({
            userId,
            username,
            temporaryPassword,
            displayName,
            role: ROLES.STUDENT,
            relatedName: `${row.name} / ${row.studentNo}`,
            studentNo: row.studentNo,
            className: row.className
        });
        recordAccountSync(summary, "created");
        return;
    }

    const nextRole = ROLES.STUDENT;
    const shouldUpdate =
        existing.displayName !== displayName ||
        existing.linkedStudentId !== studentId ||
        existing.role !== nextRole;

    if (!shouldUpdate) {
        recordAccountSync(summary, "existing");
        return;
    }

    db.prepare(
        `UPDATE users
         SET display_name = ?, role = ?, linked_student_id = ?, is_active = 1
         WHERE id = ?`
    ).run(displayName, nextRole, studentId, existing.id);
    recordAccountSync(summary, "updated");
};

const buildParentUsername = (studentNo: string, suffix = 0): string => {
    return suffix === 0 ? `parent_${studentNo}` : `parent_${studentNo}_${suffix}`;
};

const findAvailableParentUsername = (studentNo: string): string => {
    let suffix = 0;
    while (true) {
        const username = buildParentUsername(studentNo, suffix);
        const exists = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username) as { id: number } | undefined;
        if (!exists) {
            return username;
        }
        suffix += 1;
    }
};

const ensurePrimaryParentAccount = (row: StudentImportRow, studentId: number, summary: ImportSummary): void => {
    const existingLink = db.prepare(
        `SELECT psl.parent_user_id as parentUserId
         FROM parent_student_links psl
         WHERE psl.student_id = ?
         ORDER BY psl.id ASC
         LIMIT 1`
    ).get(studentId) as { parentUserId: number } | undefined;

    if (existingLink?.parentUserId) {
        db.prepare(`UPDATE students SET parent_user_id = ? WHERE id = ?`).run(existingLink.parentUserId, studentId);
        return;
    }

    const username = findAvailableParentUsername(row.studentNo);
    const displayName = `${row.name}家长`;
    const temporaryPassword = generateTemporaryPassword();
    const createdAt = dayjs().toISOString();
    const userResult = db.prepare(
        `INSERT INTO users (
            username,
            display_name,
            password_hash,
            role,
            linked_student_id,
            must_change_password,
            password_reset_at,
            is_active,
            created_at
        )
        VALUES (?, ?, ?, ?, NULL, 1, ?, 1, ?)`
    ).run(
        username,
        displayName,
        hashPassword(temporaryPassword),
        ROLES.PARENT,
        createdAt,
        createdAt
    );
    const parentUserId = Number(userResult.lastInsertRowid);

    db.prepare(
        `INSERT INTO parent_student_links (parent_user_id, student_id, relation, created_at)
         VALUES (?, ?, ?, ?)`
    ).run(parentUserId, studentId, "监护人", createdAt);
    db.prepare(`UPDATE students SET parent_user_id = ? WHERE id = ?`).run(parentUserId, studentId);

    summary.issuanceRecords.push({
        userId: parentUserId,
        username,
        temporaryPassword,
        displayName,
        role: ROLES.PARENT,
        relatedName: `${row.name} / ${row.studentNo} / ${row.className}`,
        studentNo: row.studentNo,
        className: row.className
    });
    recordAccountSync(summary, "created");
};

const syncTeacherAccount = (row: TeacherImportRow, summary: ImportSummary): number => {
    const displayName = row.displayName;
    const desiredRole = row.isHeadTeacher === 1 ? ROLES.HEAD_TEACHER : ROLES.TEACHER;
    const existing = db
        .prepare(
            `SELECT id, display_name as displayName, role
             FROM users
             WHERE username = ?`
        )
        .get(row.teacherUsername) as
        | { id: number; displayName: string; role: string }
        | undefined;

    if (!existing) {
        const temporaryPassword = generateTemporaryPassword();
        const result = db.prepare(
            `INSERT INTO users (
                username,
                display_name,
                password_hash,
                role,
                linked_student_id,
                must_change_password,
                password_reset_at,
                is_active,
                created_at
            )
            VALUES (?, ?, ?, ?, NULL, 1, ?, 1, ?)`
        ).run(
            row.teacherUsername,
            displayName,
            hashPassword(temporaryPassword),
            desiredRole,
            dayjs().toISOString(),
            dayjs().toISOString()
        );
        const userId = Number(result.lastInsertRowid);

        summary.issuanceRecords.push({
            userId,
            username: row.teacherUsername,
            temporaryPassword,
            displayName,
            role: desiredRole,
            relatedName: `${displayName} / ${row.className}`,
            className: row.className,
            subjectName: row.subjectName ?? (row.isHeadTeacher === 1 ? "班主任" : "学科待完善")
        });
        recordAccountSync(summary, "created");
        return Number(result.lastInsertRowid);
    }

    const nextRole = existing.role === ROLES.ADMIN ? ROLES.ADMIN : desiredRole;
    const shouldUpdate = existing.displayName !== displayName || existing.role !== nextRole;
    if (shouldUpdate) {
        db.prepare(
            `UPDATE users
             SET display_name = ?, role = ?, is_active = 1
             WHERE id = ?`
        ).run(displayName, nextRole, existing.id);
        recordAccountSync(summary, "updated");
    } else {
        recordAccountSync(summary, "existing");
    }

    return existing.id;
};

dataImportRouter.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.HEAD_TEACHER, ROLES.TEACHER));

dataImportRouter.get("/templates", (_req, res) => {
    res.json({
        success: true,
        message: "模板字段",
        data: {
            students: [
                "studentNo",
                "name",
                "grade",
                "className",
                "subjectCombination",
                "interests",
                "careerGoal",
                "loginUsername",
                "displayName"
            ],
            examResults: ["studentNo", "examName", "examDate", "subject", "score"],
            teachers: ["teacherUsername", "displayName", "className", "isHeadTeacher", "subjectName"]
        }
    });
});

dataImportRouter.get("/template-files/:type", (req, res) => {
    const type = req.params.type;
    const format = req.query.format === "csv" ? "csv" : "xlsx";
    const map: Record<string, Record<"csv" | "xlsx", string>> = {
        students: {
            csv: "students-template.csv",
            xlsx: "students-template.xlsx"
        },
        "exam-results": {
            csv: "exam-results-template.csv",
            xlsx: "exam-results-template.xlsx"
        },
        teachers: {
            csv: "teachers-template.csv",
            xlsx: "teachers-template.xlsx"
        }
    };

    const filename = map[type]?.[format];
    if (!filename) {
        res.status(400).json({ success: false, message: "不支持的模板类型" });
        return;
    }

    res.download(path.join(templateDir, filename), filename, (error) => {
        if (error) {
            res.status(404).json({ success: false, message: "模板文件不存在" });
        }
    });
});

dataImportRouter.post("/students", uploadSheet, (req: AuthedRequest, res) => {
    const resolved = resolveRows(req);
    if (!resolved) {
        res.status(400).json({ success: false, message: "请上传 CSV/XLSX 文件，或传入 JSON 格式 rows 数组" });
        return;
    }

    const { rows, lineOffset, source } = resolved;
    const summary = buildSummary(rows.length);
    const validRows: Array<{ line: number; data: StudentImportRow }> = [];

    rows.forEach((row, index) => {
        const line = index + lineOffset;
        const parsed = parseStudentRow(row, line, summary.errors);
        if (parsed) {
            validRows.push({ line, data: parsed });
        }
    });

    const findByStudentNo = db.prepare("SELECT id FROM students WHERE student_no = ?");
    const insertStudent = db.prepare(
        `INSERT INTO students (student_no, name, grade, class_name, subject_combination, interests, career_goal, parent_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    );
    const updateStudent = db.prepare(
        `UPDATE students
         SET name = ?, grade = ?, class_name = ?, subject_combination = ?, interests = ?, career_goal = ?
         WHERE student_no = ?`
    );

    const runImport = db.transaction((items: Array<{ line: number; data: StudentImportRow }>) => {
        for (const item of items) {
            const row = item.data;
            const existed = findByStudentNo.get(row.studentNo) as { id: number } | undefined;
            let studentId: number;

            if (existed) {
                updateStudent.run(
                    row.name,
                    row.grade,
                    row.className,
                    row.subjectCombination ?? null,
                    row.interests ?? null,
                    row.careerGoal ?? null,
                    row.studentNo
                );
                studentId = existed.id;
                summary.updated += 1;
            } else {
                const result = insertStudent.run(
                    row.studentNo,
                    row.name,
                    row.grade,
                    row.className,
                    row.subjectCombination ?? null,
                    row.interests ?? null,
                    row.careerGoal ?? null,
                    dayjs().toISOString()
                );
                studentId = Number(result.lastInsertRowid);
                summary.imported += 1;
            }

            syncStudentAccount(row, studentId, summary);
            ensurePrimaryParentAccount(row, studentId, summary);
        }
    });

    runImport(validRows);
    summary.failed = calcFailedLineCount(summary.errors);

    if (req.user && summary.issuanceRecords.length > 0) {
        summary.issuanceBatchId = createIssuanceBatch(db, {
            batchType: "student_import",
            sourceModule: "data-import",
            operatorUserId: req.user.id,
            title: `学生导入账号发放 ${dayjs().format("YYYY-MM-DD HH:mm")}`,
            items: summary.issuanceRecords
        });
    }

    if (req.user) {
        logAudit({
            userId: req.user.id,
            actionModule: "data-import",
            actionType: "import_students",
            objectType: "students",
            detail: { source, ...summary, issuanceCount: summary.issuanceRecords.length },
            ipAddress: extractIp(req)
        });
    }

    const message = summary.failed > 0 ? `导入完成，${summary.failed} 行失败` : "导入完成";
    res.json({ success: true, message, data: summary });
});

dataImportRouter.post("/exam-results", uploadSheet, (req: AuthedRequest, res) => {
    const resolved = resolveRows(req);
    if (!resolved) {
        res.status(400).json({ success: false, message: "请上传 CSV/XLSX 文件，或传入 JSON 格式 rows 数组" });
        return;
    }

    const { rows, lineOffset, source } = resolved;
    const summary = buildSummary(rows.length);
    const validRows: Array<{ line: number; data: ExamImportRow }> = [];

    rows.forEach((row, index) => {
        const line = index + lineOffset;
        const parsed = parseExamRow(row, line, summary.errors);
        if (parsed) {
            validRows.push({ line, data: parsed });
        }
    });

    const findStudent = db.prepare("SELECT id FROM students WHERE student_no = ?");
    const findExistingExam = db.prepare(
        `SELECT id
         FROM exam_results
         WHERE student_id = ? AND subject = ? AND exam_name = ? AND exam_date = ?
         LIMIT 1`
    );
    const insertExam = db.prepare(
        `INSERT INTO exam_results (student_id, subject, exam_name, exam_date, score, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    const updateExam = db.prepare("UPDATE exam_results SET score = ? WHERE id = ?");

    const runImport = db.transaction((items: Array<{ line: number; data: ExamImportRow }>) => {
        for (const item of items) {
            const row = item.data;
            const student = findStudent.get(row.studentNo) as { id: number } | undefined;
            if (!student) {
                summary.errors.push({ line: item.line, field: "studentNo", reason: `学号 ${row.studentNo} 不存在` });
                continue;
            }

            const existing = findExistingExam.get(student.id, row.subject, row.examName, row.examDate) as { id: number } | undefined;
            if (existing) {
                updateExam.run(row.score, existing.id);
                summary.updated += 1;
            } else {
                insertExam.run(student.id, row.subject, row.examName, row.examDate, row.score, dayjs().toISOString());
                summary.imported += 1;
            }
        }
    });

    runImport(validRows);
    summary.failed = calcFailedLineCount(summary.errors);

    if (req.user) {
        logAudit({
            userId: req.user.id,
            actionModule: "data-import",
            actionType: "import_exam_results",
            objectType: "exam_results",
            detail: { source, ...summary },
            ipAddress: extractIp(req)
        });
    }

    const message = summary.failed > 0 ? `导入完成，${summary.failed} 行失败` : "导入完成";
    res.json({ success: true, message, data: summary });
});

dataImportRouter.post("/teachers", uploadSheet, (req: AuthedRequest, res) => {
    const resolved = resolveRows(req);
    if (!resolved) {
        res.status(400).json({ success: false, message: "请上传 CSV/XLSX 文件，或传入 JSON 格式 rows 数组" });
        return;
    }

    const { rows, lineOffset, source } = resolved;
    const summary = buildSummary(rows.length);
    const validRows: Array<{ line: number; data: TeacherImportRow }> = [];

    rows.forEach((row, index) => {
        const line = index + lineOffset;
        const parsed = parseTeacherRow(row, line, summary.errors);
        if (parsed) {
            validRows.push({ line, data: parsed });
        }
    });

    const findLink = db.prepare(
        `SELECT id
         FROM teacher_class_links
         WHERE teacher_user_id = ? AND class_name = ?
         LIMIT 1`
    );
    const insertLink = db.prepare(
        `INSERT INTO teacher_class_links (teacher_user_id, class_name, subject_name, is_head_teacher, created_at)
         VALUES (?, ?, ?, ?, ?)`
    );
    const updateLink = db.prepare(
        `UPDATE teacher_class_links
         SET subject_name = ?, is_head_teacher = ?
         WHERE id = ?`
    );

    const runImport = db.transaction((items: Array<{ line: number; data: TeacherImportRow }>) => {
        for (const item of items) {
            const row = item.data;
            const teacherUserId = syncTeacherAccount(row, summary);
            const subjectName = row.subjectName ?? (row.isHeadTeacher === 1 ? "班主任" : "学科待完善");
            const existing = findLink.get(teacherUserId, row.className) as { id: number } | undefined;

            if (existing) {
                updateLink.run(subjectName, row.isHeadTeacher, existing.id);
                summary.updated += 1;
            } else {
                insertLink.run(teacherUserId, row.className, subjectName, row.isHeadTeacher, dayjs().toISOString());
                summary.imported += 1;
            }
        }
    });

    runImport(validRows);
    summary.failed = calcFailedLineCount(summary.errors);

    if (req.user) {
        logAudit({
            userId: req.user.id,
            actionModule: "data-import",
            actionType: "import_teachers",
            objectType: "teacher_class_links",
            detail: { source, ...summary, issuanceCount: summary.issuanceRecords.length },
            ipAddress: extractIp(req)
        });
    }

    const message = summary.failed > 0 ? `导入完成，${summary.failed} 行失败` : "导入完成";
    res.json({ success: true, message, data: summary });
});

dataImportRouter.get("/exam-results/manage", (req: AuthedRequest, res) => {
    const examName = typeof req.query.examName === "string" ? repairText(req.query.examName) : "";
    const examDate = typeof req.query.examDate === "string" ? req.query.examDate : "";

    let rows = db
        .prepare(
            `SELECT er.id, s.student_no as studentNo, s.name as studentName, s.class_name as className,
                    er.exam_name as examName, er.exam_date as examDate, er.subject, er.score
             FROM exam_results er
             JOIN students s ON s.id = er.student_id
             ORDER BY er.exam_date DESC, er.exam_name DESC, er.id DESC
             LIMIT 400`
        )
        .all() as Array<Record<string, unknown>>;

    rows = rows.map((item) => {
        const repaired = repairRecordStrings(item);
        return {
            ...repaired,
            examName: normalizeExamName(repaired.examName) || repaired.examName
        };
    });

    if (examName) {
        rows = rows.filter((item) => String(item.examName).includes(examName));
    }
    if (examDate) {
        rows = rows.filter((item) => String(item.examDate) === examDate);
    }

    res.json({ success: true, message: "查询成功", data: rows });
});

dataImportRouter.post("/exam-results/batch-delete", (req: AuthedRequest, res) => {
    const parsed = z.object({ ids: z.array(z.number().int().positive()).min(1) }).safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    db.prepare(`DELETE FROM exam_results WHERE id IN (${parsed.data.ids.map(() => "?").join(",")})`).run(...parsed.data.ids);
    logAudit({
        userId: req.user.id,
        actionModule: "data-import",
        actionType: "delete_exam_results",
        objectType: "exam_results",
        detail: { ids: parsed.data.ids, count: parsed.data.ids.length },
        ipAddress: extractIp(req)
    });
    res.json({ success: true, message: `已删除 ${parsed.data.ids.length} 条成绩记录` });
});

dataImportRouter.get("/teachers/manage", (req: AuthedRequest, res) => {
    const rows = db
        .prepare(
            `SELECT tcl.id, u.id as teacherUserId, u.username as teacherUsername, u.display_name as displayName,
                    tcl.class_name as className, tcl.subject_name as subjectName, tcl.is_head_teacher as isHeadTeacher
             FROM teacher_class_links tcl
             JOIN users u ON u.id = tcl.teacher_user_id
             ORDER BY tcl.class_name ASC, u.username ASC`
        )
        .all();

    res.json({ success: true, message: "查询成功", data: rows });
});

dataImportRouter.post("/teachers/batch-delete", (req: AuthedRequest, res) => {
    const parsed = z.object({ ids: z.array(z.number().int().positive()).min(1) }).safeParse(req.body);
    if (!parsed.success || !req.user) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const rows = db
        .prepare(`SELECT id, teacher_user_id as teacherUserId FROM teacher_class_links WHERE id IN (${parsed.data.ids.map(() => "?").join(",")})`)
        .all(...parsed.data.ids) as Array<{ id: number; teacherUserId: number }>;

    const transaction = db.transaction((items: Array<{ id: number; teacherUserId: number }>) => {
        for (const item of items) {
            db.prepare(`DELETE FROM teacher_class_links WHERE id = ?`).run(item.id);
            const remaining = db
                .prepare(`SELECT COUNT(*) as count FROM teacher_class_links WHERE teacher_user_id = ?`)
                .get(item.teacherUserId) as { count: number };
            const user = db.prepare(`SELECT role FROM users WHERE id = ?`).get(item.teacherUserId) as { role: string } | undefined;
            if (remaining.count === 0 && user && user.role !== ROLES.ADMIN) {
                deleteUserWithIssuance(db, item.teacherUserId);
            }
        }
    });

    transaction(rows);

    logAudit({
        userId: req.user.id,
        actionModule: "data-import",
        actionType: "delete_teacher_links",
        objectType: "teacher_class_links",
        detail: { ids: parsed.data.ids, count: parsed.data.ids.length },
        ipAddress: extractIp(req)
    });

    res.json({ success: true, message: `已删除 ${parsed.data.ids.length} 条教师班级关系` });
});
