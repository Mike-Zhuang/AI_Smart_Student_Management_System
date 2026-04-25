import iconv from "iconv-lite";

const MOJIBAKE_PATTERNS = [
    /�/,
    /锟/,
    /瀛|鏂|鎷|閿|鍐|璇|鏉|甯|骞|妯/,
    /鐢|鏈|瑕|濂|涔|犲|夭|鍚|鍙|鐜|嬭/,
    /Ã|Â|ð|Ð|¢/,
    /ç”|æœ|å¥|å­|ä¹|å¤|å|ä¸/,
    /ó|Ô|Ã|Ñ|ï|ì|é|ò/,
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/,
    /å|æ|ç|è|é/
];

const CAMPUS_KEYWORDS = /学年|学期|考试|班级|学生|班主任|家长|请假|通知|成长|画像|账号|成绩|化学|生物|地理|政治|语文|数学|英语|物理|历史|高一|高二|高三|选科|专业/;

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
    { table: "account_issuance_items", key: "id", columns: ["username", "display_name", "role", "related_name", "student_no", "class_name", "subject_name", "invalidation_reason"] },
    { table: "chat_sessions", key: "id", columns: ["title", "scenario", "model"] },
    { table: "chat_messages", key: "id", columns: ["content", "reasoning_content"] }
];

const trimInvisible = (value: string): string => {
    return value
        .replace(/^\uFEFF/, "")
        .replace(/\u00A0/g, " ")
        .replace(/\u3000/g, " ")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/\r/g, "")
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
    if (CAMPUS_KEYWORDS.test(value)) {
        score += 4;
    }
    if (/[a-z]{4,}/i.test(value) && !/[A-Z][a-z]+/.test(value) && !/https?:/i.test(value)) {
        score -= 2;
    }
    if (/[\u4e00-\u9fa5]{3,}/.test(value)) {
        score += 2;
    }
    return score;
};

const normalizeDisplayText = (value: string): string => {
    return trimInvisible(value)
        .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
        .replace(/[【】]/g, (char) => (char === "【" ? "[" : "]"))
        .replace(/[“”]/g, "\"")
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, " ")
        .trim();
};

const getChineseRatio = (value: string): number => {
    if (!value) {
        return 0;
    }
    const chinese = (value.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    return chinese / value.length;
};

const decodeWithEncodingFallback = (buffer: Buffer, encodings: string[]): string[] => {
    return encodings
        .map((encoding) => {
            try {
                return iconv.decode(buffer, encoding);
            } catch {
                return "";
            }
        })
        .filter(Boolean);
};

const tryReDecode = (value: string): string[] => {
    const utf8FromLatin1 = Buffer.from(value, "latin1").toString("utf8");
    const gbkFromLatin1 = iconv.decode(Buffer.from(value, "latin1"), "gbk");
    const gb18030FromLatin1 = iconv.decode(Buffer.from(value, "latin1"), "gb18030");
    const utf8FromGbk = iconv.decode(Buffer.from(value, "binary"), "gbk");
    const gb18030FromUtf8 = iconv.decode(Buffer.from(value, "utf8"), "gb18030");
    const utf8FromEncodedGbk = iconv.encode(value, "gbk").toString("utf8");
    const utf8FromEncodedGb18030 = iconv.encode(value, "gb18030").toString("utf8");
    const gbkFromUtf8Buffer = iconv.decode(Buffer.from(value, "utf8"), "gbk");
    const gb18030FromUtf8Buffer = iconv.decode(Buffer.from(value, "utf8"), "gb18030");

    return [
        utf8FromLatin1,
        gbkFromLatin1,
        gb18030FromLatin1,
        utf8FromGbk,
        gb18030FromUtf8,
        utf8FromEncodedGbk,
        utf8FromEncodedGb18030,
        gbkFromUtf8Buffer,
        gb18030FromUtf8Buffer
    ];
};

const isUtf8ReadAsGbkMojibake = (value: string): boolean => {
    return /鐜|嬭|鐢|鏈|瑕|濂|涔|犲|鍚|鍙|瀛|鏂|鎷|閿|鍐|璇|鏉|甯|骞/.test(value);
};

const hasReplacementNoise = (value: string): boolean => /�|锟/.test(value);

const preferRecoveredCandidate = (original: string, candidate: string): boolean => {
    if (!isUtf8ReadAsGbkMojibake(original)) {
        return false;
    }

    if (!candidate || candidate === original || hasReplacementNoise(candidate) || needsRepair(candidate)) {
        return false;
    }

    if (candidate.length > original.length) {
        return false;
    }

    const originalScore = scoreCandidate(original);
    const candidateScore = scoreCandidate(candidate);
    const candidateChineseRatio = getChineseRatio(candidate);
    return candidateChineseRatio >= 0.5 && candidateScore >= originalScore + 2;
};

const isLikelyUnreadable = (value: string): boolean => {
    const normalized = normalizeDisplayText(value);
    if (!normalized) {
        return true;
    }

    const score = scoreCandidate(normalized);
    const chineseRatio = getChineseRatio(normalized);
    const hasCommonMojibake = needsRepair(normalized);
    const obviousUnreadablePattern =
        /锟斤拷|瀛﹂敓|鐢辨湀|ç”±|óéÔÂ|C"2AX/i.test(normalized) ||
        (/[ÃÂåæçéó]/.test(normalized) && chineseRatio < 0.15);

    if (obviousUnreadablePattern) {
        return true;
    }

    if (hasCommonMojibake && score < 6) {
        return true;
    }

    if (!/[\u4e00-\u9fa5]/.test(normalized) && /[ÃÂåæçéó锟瀛鏂鎷]/.test(normalized)) {
        return true;
    }

    return false;
};

export const decodeTextBuffer = (buffer: Buffer): string => {
    const candidates = [
        buffer.toString("utf8"),
        ...decodeWithEncodingFallback(buffer, ["gbk", "gb18030"]),
        ...decodeWithEncodingFallback(Buffer.from(buffer.toString("latin1"), "utf8"), ["gbk", "gb18030"])
    ]
        .map(normalizeDisplayText)
        .filter(Boolean);

    return candidates.sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0] ?? "";
};

export const repairText = (value: unknown): string => {
    if (typeof value !== "string") {
        return value === null || value === undefined ? "" : String(value);
    }

    const normalized = normalizeDisplayText(value);
    if (!normalized) {
        return "";
    }

    if (!needsRepair(normalized)) {
        return normalized;
    }

    const recoveredCandidates = tryReDecode(normalized).map(normalizeDisplayText).filter(Boolean);
    const preferred = recoveredCandidates
        .filter((candidate) => preferRecoveredCandidate(normalized, candidate))
        .sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0];
    if (preferred) {
        return preferred;
    }

    const candidates = [normalized, ...recoveredCandidates].filter(Boolean);
    return candidates.sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0] ?? normalized;
};

export const sanitizeModelInputText = (value: unknown, fallback = "暂无有效信息"): string => {
    const repaired = repairText(value);
    if (!repaired) {
        return fallback;
    }

    if (isLikelyUnreadable(repaired)) {
        return fallback;
    }

    return repaired;
};

export const MOJIBAKE_SYSTEM_HINT =
    "若输入中仍残留少量乱码，请仅按常见编码误读规律做谨慎理解：例如 GBK 误读 UTF-8 常见为“鐢辨湀/瀛﹂敓”，UTF-8 误读 GBK 常见为“锟斤拷”，ISO8859-1 误读可能出现“ç”±/óéÔÂ”等。只有在语义高度确定时才可尝试恢复；若无法确定，必须明确视为无效信息，禁止自行编造。";

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
        .replace(/\s+/g, "")
        .replace(/学年第/g, "学年 第")
        .replace(/第([一二三四])学期/g, "第$1学期")
        .replace(/锟斤拷/g, "")
        .replace(/瀛﹂敓|鏁版嵁|鐢熸垚|鑰冭瘯/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const yearMatch = normalized.match(/(20\d{2})学年/);
    if (yearMatch) {
        const year = Number(yearMatch[1]);
        if (year < 2020 || year > 2035) {
            return "";
        }
    }

    if (needsRepair(normalized) && !CAMPUS_KEYWORDS.test(normalized)) {
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
