import iconv from "iconv-lite";

const MOJIBAKE_PATTERNS = [/�/, /锟/, /Ã/, /Â/, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/, /å|æ|ç|è|é/];

const TABLE_TEXT_COLUMNS: Array<{ table: string; key: string; columns: string[] }> = [
    { table: "students", key: "id", columns: ["name", "grade", "class_name", "interests", "career_goal", "subject_combination"] },
    { table: "exam_results", key: "id", columns: ["subject", "exam_name"] },
    { table: "growth_profiles", key: "student_id", columns: ["summary"] },
    { table: "alerts", key: "id", columns: ["alert_type", "content", "status"] },
    { table: "messages", key: "id", columns: ["title", "content", "module", "receiver_role"] },
    { table: "leave_requests", key: "id", columns: ["leave_type", "reason", "contact_phone", "emergency_contact", "parent_confirm_status", "parent_confirm_note", "review_status", "review_note", "completion_status"] },
    { table: "teacher_class_links", key: "id", columns: ["class_name", "subject_name"] },
    { table: "users", key: "id", columns: ["display_name", "phone", "email"] },
    { table: "class_logs", key: "id", columns: ["category", "title", "content", "student_name"] },
    { table: "wellbeing_posts", key: "id", columns: ["title", "content", "attachment_name"] },
    { table: "class_gallery", key: "id", columns: ["title", "description", "activity_date", "file_name"] },
    { table: "class_profiles", key: "class_name", columns: ["class_motto", "class_style", "class_slogan", "course_schedule", "class_rules", "seat_map", "class_committee"] },
    { table: "group_score_records", key: "id", columns: ["group_name", "activity_name", "note"] },
    { table: "account_issuance_batches", key: "id", columns: ["batch_type", "source_module", "title", "note"] },
    { table: "account_issuance_items", key: "id", columns: ["username", "display_name", "role", "related_name", "student_no", "class_name", "subject_name", "invalidation_reason"] }
];

const trimInvisible = (value: string): string => {
    return value
        .replace(/^\uFEFF/, "")
        .replace(/\u00A0/g, " ")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .trim();
};

const needsRepair = (value: string): boolean => {
    return MOJIBAKE_PATTERNS.some((pattern) => pattern.test(value));
};

const scoreCandidate = (value: string): number => {
    let score = 0;
    if (/[\u4e00-\u9fa5]/.test(value)) {
        score += 6;
    }
    if (!needsRepair(value)) {
        score += 4;
    }
    if (/锟/.test(value)) {
        score -= 8;
    }
    if (/�/.test(value)) {
        score -= 6;
    }
    if (/学年|学期|考试|班|学生|班主任|请假|通知|成长|化学|生物|地理|政治|语文|数学|英语|物理|历史/.test(value)) {
        score += 4;
    }
    return score;
};

const tryReDecode = (value: string): string[] => {
    const utf8FromLatin1 = Buffer.from(value, "latin1").toString("utf8");
    const gbkFromLatin1 = iconv.decode(Buffer.from(value, "latin1"), "gbk");
    const gb18030FromLatin1 = iconv.decode(Buffer.from(value, "latin1"), "gb18030");
    const utf8FromGbk = iconv.decode(Buffer.from(value, "binary"), "gbk");
    const gb18030FromUtf8 = iconv.decode(Buffer.from(value, "utf8"), "gb18030");
    return [utf8FromLatin1, gbkFromLatin1, gb18030FromLatin1, utf8FromGbk, gb18030FromUtf8];
};

export const decodeTextBuffer = (buffer: Buffer): string => {
    const candidates = [
        buffer.toString("utf8"),
        iconv.decode(buffer, "gbk"),
        iconv.decode(buffer, "gb18030")
    ]
        .map(trimInvisible)
        .filter(Boolean);

    return candidates.sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0] ?? "";
};

export const repairText = (value: unknown): string => {
    if (typeof value !== "string") {
        return value === null || value === undefined ? "" : String(value);
    }

    const normalized = trimInvisible(value);
    if (!normalized) {
        return "";
    }

    const candidates = [normalized, ...tryReDecode(normalized).map(trimInvisible)].filter(Boolean);
    return candidates.sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0] ?? normalized;
};

export const repairRecordStrings = <T extends Record<string, unknown>>(record: T): T => {
    const next = { ...record };
    for (const [key, value] of Object.entries(next)) {
        if (typeof value === "string") {
            next[key as keyof T] = repairText(value) as T[keyof T];
        }
    }
    return next;
};

export const normalizeExamName = (value: unknown): string => {
    const repaired = repairText(value);
    if (!repaired) {
        return "";
    }

    const normalized = repaired
        .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
        .replace(/\s+/g, "")
        .replace(/学年第/g, "学年 第")
        .replace(/第([一二三四])学期/g, "第$1学期")
        .replace(/锟斤拷/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const yearMatch = normalized.match(/(20\d{2})学年/);
    if (yearMatch) {
        const year = Number(yearMatch[1]);
        if (year < 2020 || year > 2035) {
            return "";
        }
    }

    if (needsRepair(normalized)) {
        return "";
    }

    return normalized;
};

export const normalizeClassName = (value: unknown): string => {
    return repairText(value).replace(/\s+/g, "");
};

export const normalizeName = (value: unknown): string => {
    return repairText(value).replace(/\s+/g, "");
};

export const repairDatabaseText = (db: import("better-sqlite3").Database): void => {
    for (const target of TABLE_TEXT_COLUMNS) {
        const rows = db.prepare(`SELECT ${target.key}, ${target.columns.join(", ")} FROM ${target.table}`).all() as Array<Record<string, unknown>>;
        if (rows.length === 0) {
            continue;
        }

        const updateAssignments = target.columns.map((column) => `${column} = @${column}`).join(", ");
        const stmt = db.prepare(`UPDATE ${target.table} SET ${updateAssignments} WHERE ${target.key} = @key`);

        const transaction = db.transaction((items: Array<Record<string, unknown>>) => {
            for (const row of items) {
                const payload: Record<string, unknown> = { key: row[target.key] };
                let changed = false;

                for (const column of target.columns) {
                    const value = row[column];
                    if (typeof value === "string") {
                        const repaired = repairText(value);
                        payload[column] = repaired;
                        if (repaired !== value) {
                            changed = true;
                        }
                    } else {
                        payload[column] = value;
                    }
                }

                if (changed) {
                    stmt.run(payload);
                }
            }
        });

        transaction(rows);
    }
};
