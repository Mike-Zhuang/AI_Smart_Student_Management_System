import { Router } from "express";
import type { NextFunction, Response } from "express";
import dayjs from "dayjs";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "node:url";
import path from "node:path";
import multer from "multer";
import { z } from "zod";
import { ROLES } from "../constants.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";

type CsvRecord = Record<string, unknown>;

type ImportErrorItem = {
    line: number;
    field: string;
    reason: string;
};

type ImportSummary = {
    total: number;
    imported: number;
    updated: number;
    ignored: number;
    failed: number;
    errors: ImportErrorItem[];
};

type StudentImportRow = {
    studentNo: string;
    name: string;
    grade: string;
    className: string;
    subjectCombination?: string;
    interests?: string;
    careerGoal?: string;
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
    className: string;
    isHeadTeacher: number;
    subjectName?: string;
};

const studentRowSchema = z.object({
    studentNo: z.string().min(4, "学号长度至少4位"),
    name: z.string().min(2, "姓名长度至少2位"),
    grade: z.string().min(2, "年级不能为空"),
    className: z.string().min(2, "班级不能为空"),
    subjectCombination: z.string().optional(),
    interests: z.string().optional(),
    careerGoal: z.string().optional()
});

const examRowSchema = z.object({
    studentNo: z.string().min(4, "学号长度至少4位"),
    examName: z.string().min(2, "考试名称不能为空"),
    examDate: z.string().min(8, "考试日期格式错误"),
    subject: z.string().min(2, "科目不能为空"),
    score: z.number().min(0, "分数不能小于0").max(100, "分数不能大于100")
});

const teacherRowSchema = z.object({
    teacherUsername: z.string().min(2, "教师账号不能为空"),
    className: z.string().min(2, "班级不能为空"),
    subjectName: z.string().optional()
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const mime = file.mimetype.toLowerCase();
        const filename = file.originalname.toLowerCase();
        const isCsvMime = ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"].includes(mime);
        const isCsvName = filename.endsWith(".csv");
        if (!isCsvMime && !isCsvName) {
            callback(new Error("仅支持CSV文件上传"));
            return;
        }
        callback(null, true);
    }
});

export const dataImportRouter = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateDir = path.resolve(__dirname, "../../templates");

const uploadCsv = (req: AuthedRequest, res: Response, next: NextFunction): void => {
    upload.single("file")(req, res, (error: unknown) => {
        if (!error) {
            next();
            return;
        }

        if (error instanceof multer.MulterError) {
            if (error.code === "LIMIT_FILE_SIZE") {
                res.status(400).json({ success: false, message: "上传文件过大，最大支持5MB" });
                return;
            }
            res.status(400).json({ success: false, message: "文件上传失败，请检查CSV格式" });
            return;
        }

        const message = error instanceof Error ? error.message : "文件上传失败";
        res.status(400).json({ success: false, message });
    });
};

const normalizeRecord = (record: CsvRecord): CsvRecord => {
    const normalized: CsvRecord = {};
    for (const [rawKey, value] of Object.entries(record)) {
        const key = rawKey.trim();
        normalized[key] = value;
    }
    return normalized;
};

const parseCsvRows = (buffer: Buffer): CsvRecord[] => {
    const text = buffer.toString("utf-8");
    const rows = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true
    }) as CsvRecord[];
    return rows.map(normalizeRecord);
};

const tryParseJsonRows = (value: unknown): CsvRecord[] | null => {
    if (Array.isArray(value)) {
        return value.map((item) => (item && typeof item === "object" ? (item as CsvRecord) : {}));
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value) as unknown;
            if (!Array.isArray(parsed)) {
                return null;
            }
            return parsed.map((item) => (item && typeof item === "object" ? (item as CsvRecord) : {}));
        } catch {
            return null;
        }
    }

    return null;
};

const resolveRows = (req: AuthedRequest): { rows: CsvRecord[]; lineOffset: number } | null => {
    if (req.file) {
        try {
            return { rows: parseCsvRows(req.file.buffer), lineOffset: 2 };
        } catch {
            return null;
        }
    }

    const rows = tryParseJsonRows(req.body?.rows);
    if (!rows) {
        return null;
    }

    return { rows, lineOffset: 1 };
};

const pickValue = (row: CsvRecord, aliases: string[]): unknown => {
    for (const alias of aliases) {
        if (Object.prototype.hasOwnProperty.call(row, alias)) {
            return row[alias];
        }
    }
    return undefined;
};

const toRequiredString = (value: unknown): string => {
    if (typeof value === "string") {
        return value.trim();
    }
    if (value === null || value === undefined) {
        return "";
    }
    return String(value).trim();
};

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

const parseStudentRow = (row: CsvRecord, line: number, errors: ImportErrorItem[]): StudentImportRow | null => {
    const candidate = {
        studentNo: toRequiredString(pickValue(row, ["studentNo", "student_no", "学号"])),
        name: toRequiredString(pickValue(row, ["name", "姓名"])),
        grade: toRequiredString(pickValue(row, ["grade", "年级"])),
        className: toRequiredString(pickValue(row, ["className", "class_name", "班级"])),
        subjectCombination: toOptionalString(pickValue(row, ["subjectCombination", "subject_combination", "选科组合"])),
        interests: toOptionalString(pickValue(row, ["interests", "兴趣"])),
        careerGoal: toOptionalString(pickValue(row, ["careerGoal", "career_goal", "职业目标"]))
    };

    const parsed = studentRowSchema.safeParse(candidate);
    if (!parsed.success) {
        appendZodErrors(errors, line, parsed.error);
        return null;
    }

    return parsed.data;
};

const parseExamRow = (row: CsvRecord, line: number, errors: ImportErrorItem[]): ExamImportRow | null => {
    const scoreRaw = pickValue(row, ["score", "分数"]);
    const score = typeof scoreRaw === "number" ? scoreRaw : Number(toRequiredString(scoreRaw));

    const candidate = {
        studentNo: toRequiredString(pickValue(row, ["studentNo", "student_no", "学号"])),
        examName: toRequiredString(pickValue(row, ["examName", "exam_name", "考试名称"])),
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
        if (value === 0 || value === 1) {
            return value;
        }
        return null;
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

const parseTeacherRow = (row: CsvRecord, line: number, errors: ImportErrorItem[]): TeacherImportRow | null => {
    const flag = parseHeadTeacherFlag(pickValue(row, ["isHeadTeacher", "is_head_teacher", "是否班主任"]));
    if (flag === null) {
        errors.push({ line, field: "isHeadTeacher", reason: "是否班主任仅支持0/1或true/false" });
        return null;
    }

    const candidate = {
        teacherUsername: toRequiredString(pickValue(row, ["teacherUsername", "teacher_username", "教师账号"])),
        className: toRequiredString(pickValue(row, ["className", "class_name", "班级"])),
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
    errors: []
});

const calcFailedLineCount = (errors: ImportErrorItem[]): number => {
    return new Set(errors.map((item) => item.line)).size;
};

dataImportRouter.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.HEAD_TEACHER));

dataImportRouter.get("/templates", (_req, res) => {
    res.json({
        success: true,
        message: "模板字段",
        data: {
            students: ["studentNo", "name", "grade", "className", "subjectCombination", "interests", "careerGoal"],
            examResults: ["studentNo", "examName", "examDate", "subject", "score"],
            teachers: ["teacherUsername", "className", "isHeadTeacher", "subjectName"]
        }
    });
});

dataImportRouter.get("/template-files/:type", (req, res) => {
    const type = req.params.type;
    const map: Record<string, string> = {
        students: "students-template.csv",
        "exam-results": "exam-results-template.csv",
        teachers: "teachers-template.csv"
    };

    const filename = map[type];
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

dataImportRouter.post("/students", uploadCsv, (req: AuthedRequest, res) => {
    const resolved = resolveRows(req);
    if (!resolved) {
        res.status(400).json({ success: false, message: "请上传CSV文件，或传入JSON格式 rows 数组" });
        return;
    }

    const { rows, lineOffset } = resolved;
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
         SET name = ?,
             grade = ?,
             class_name = ?,
             subject_combination = ?,
             interests = ?,
             career_goal = ?
         WHERE student_no = ?`
    );

    const runImport = db.transaction((items: Array<{ line: number; data: StudentImportRow }>) => {
        for (const item of items) {
            const row = item.data;
            const existed = findByStudentNo.get(row.studentNo) as { id: number } | undefined;
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
                summary.updated += 1;
            } else {
                insertStudent.run(
                    row.studentNo,
                    row.name,
                    row.grade,
                    row.className,
                    row.subjectCombination ?? null,
                    row.interests ?? null,
                    row.careerGoal ?? null,
                    dayjs().toISOString()
                );
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
            actionType: "import_students",
            objectType: "students",
            detail: { source: req.file ? "csv" : "json", ...summary },
            ipAddress: extractIp(req)
        });
    }

    const message = summary.failed > 0 ? `导入完成，${summary.failed} 行失败` : "导入完成";
    res.json({ success: true, message, data: summary });
});

dataImportRouter.post("/exam-results", uploadCsv, (req: AuthedRequest, res) => {
    const resolved = resolveRows(req);
    if (!resolved) {
        res.status(400).json({ success: false, message: "请上传CSV文件，或传入JSON格式 rows 数组" });
        return;
    }

    const { rows, lineOffset } = resolved;
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
            detail: { source: req.file ? "csv" : "json", ...summary },
            ipAddress: extractIp(req)
        });
    }

    const message = summary.failed > 0 ? `导入完成，${summary.failed} 行失败` : "导入完成";
    res.json({ success: true, message, data: summary });
});

dataImportRouter.post("/teachers", uploadCsv, (req: AuthedRequest, res) => {
    const resolved = resolveRows(req);
    if (!resolved) {
        res.status(400).json({ success: false, message: "请上传CSV文件，或传入JSON格式 rows 数组" });
        return;
    }

    const { rows, lineOffset } = resolved;
    const summary = buildSummary(rows.length);
    const validRows: Array<{ line: number; data: TeacherImportRow }> = [];

    rows.forEach((row, index) => {
        const line = index + lineOffset;
        const parsed = parseTeacherRow(row, line, summary.errors);
        if (parsed) {
            validRows.push({ line, data: parsed });
        }
    });

    const findTeacher = db.prepare(
        `SELECT id, role
         FROM users
         WHERE username = ? AND role IN (?, ?, ?)
         LIMIT 1`
    );
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
         SET subject_name = ?,
             is_head_teacher = ?
         WHERE id = ?`
    );

    const runImport = db.transaction((items: Array<{ line: number; data: TeacherImportRow }>) => {
        for (const item of items) {
            const row = item.data;
            const teacher = findTeacher.get(row.teacherUsername, ROLES.TEACHER, ROLES.HEAD_TEACHER, ROLES.ADMIN) as
                | { id: number; role: string }
                | undefined;

            if (!teacher) {
                summary.errors.push({ line: item.line, field: "teacherUsername", reason: `教师账号 ${row.teacherUsername} 不存在` });
                continue;
            }

            const subjectName = row.subjectName ?? (row.isHeadTeacher === 1 ? "班主任" : "学科待完善");
            const existing = findLink.get(teacher.id, row.className) as { id: number } | undefined;
            if (existing) {
                updateLink.run(subjectName, row.isHeadTeacher, existing.id);
                summary.updated += 1;
            } else {
                insertLink.run(teacher.id, row.className, subjectName, row.isHeadTeacher, dayjs().toISOString());
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
            detail: { source: req.file ? "csv" : "json", ...summary },
            ipAddress: extractIp(req)
        });
    }

    const message = summary.failed > 0 ? `导入完成，${summary.failed} 行失败` : "导入完成";
    res.json({ success: true, message, data: summary });
});
