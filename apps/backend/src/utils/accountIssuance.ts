import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import dayjs from "dayjs";
import XLSX from "xlsx";
import type { db as databaseInstance } from "../db.js";

type SqliteDatabase = typeof databaseInstance;

type IssuanceItemDraft = {
    userId: number;
    username: string;
    displayName: string;
    role: string;
    relatedName: string;
    studentNo?: string | null;
    className?: string | null;
    subjectName?: string | null;
    temporaryPassword: string;
};

type CreateIssuanceBatchInput = {
    batchType: string;
    sourceModule: string;
    operatorUserId: number;
    title: string;
    note?: string | null;
    items: IssuanceItemDraft[];
};

type DownloadableIssuanceItem = {
    id: number;
    batchId: number;
    username: string;
    displayName: string;
    role: string;
    relatedName: string | null;
    studentNo: string | null;
    className: string | null;
    subjectName: string | null;
    passwordCiphertext: string;
    passwordIv: string;
    passwordAuthTag: string;
    createdAt: string;
};

const ARCHIVE_SECRET = process.env.ACCOUNT_ARCHIVE_SECRET || process.env.JWT_SECRET || "dev-account-archive-secret";

const buildCipherKey = (): Buffer => {
    return createHash("sha256").update(ARCHIVE_SECRET).digest();
};

const encryptPassword = (plainText: string): { ciphertext: string; iv: string; authTag: string } => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", buildCipherKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        ciphertext: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64")
    };
};

const decryptPassword = (item: DownloadableIssuanceItem): string => {
    const decipher = createDecipheriv("aes-256-gcm", buildCipherKey(), Buffer.from(item.passwordIv, "base64"));
    decipher.setAuthTag(Buffer.from(item.passwordAuthTag, "base64"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(item.passwordCiphertext, "base64")),
        decipher.final()
    ]);
    return decrypted.toString("utf8");
};

export const createIssuanceBatch = (db: SqliteDatabase, input: CreateIssuanceBatchInput): number | null => {
    if (input.items.length === 0) {
        return null;
    }

    const now = dayjs().toISOString();
    const batchInsert = db.prepare(
        `INSERT INTO account_issuance_batches (batch_type, source_module, operator_user_id, title, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    const itemInsert = db.prepare(
        `INSERT INTO account_issuance_items (
            batch_id,
            user_id,
            username,
            display_name,
            role,
            related_name,
            student_no,
            class_name,
            subject_name,
            can_download_password,
            password_ciphertext,
            password_iv,
            password_auth_tag,
            invalidated_at,
            invalidation_reason,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, NULL, ?)`
    );

    const transaction = db.transaction(() => {
        const batchResult = batchInsert.run(
            input.batchType,
            input.sourceModule,
            input.operatorUserId,
            input.title,
            input.note ?? null,
            now
        );
        const batchId = Number(batchResult.lastInsertRowid);

        input.items.forEach((item) => {
            const encrypted = encryptPassword(item.temporaryPassword);
            itemInsert.run(
                batchId,
                item.userId,
                item.username,
                item.displayName,
                item.role,
                item.relatedName,
                item.studentNo ?? null,
                item.className ?? null,
                item.subjectName ?? null,
                encrypted.ciphertext,
                encrypted.iv,
                encrypted.authTag,
                now
            );
        });

        return batchId;
    });

    return transaction();
};

export const invalidateUserIssuancePasswords = (db: SqliteDatabase, userId: number, reason = "user_changed_password"): void => {
    db.prepare(
        `UPDATE account_issuance_items
         SET can_download_password = 0,
             invalidated_at = ?,
             invalidation_reason = ?
         WHERE user_id = ? AND can_download_password = 1`
    ).run(dayjs().toISOString(), reason, userId);
};

export const getDownloadableIssuanceItems = (
    db: SqliteDatabase,
    options: { batchId?: number; itemIds?: number[] }
): { items: DownloadableIssuanceItem[]; skippedCount: number } => {
    const filters: string[] = ["can_download_password = 1"];
    const args: Array<number> = [];

    if (options.batchId) {
        filters.push("batch_id = ?");
        args.push(options.batchId);
    }

    if (options.itemIds && options.itemIds.length > 0) {
        filters.push(`id IN (${options.itemIds.map(() => "?").join(",")})`);
        args.push(...options.itemIds);
    }

    const items = db.prepare(
        `SELECT id, batch_id as batchId, username, display_name as displayName, role, related_name as relatedName,
                student_no as studentNo, class_name as className, subject_name as subjectName,
                password_ciphertext as passwordCiphertext, password_iv as passwordIv,
                password_auth_tag as passwordAuthTag, created_at as createdAt
         FROM account_issuance_items
         WHERE ${filters.join(" AND ")}
         ORDER BY id ASC`
    ).all(...args) as DownloadableIssuanceItem[];

    let skippedCount = 0;
    if (options.itemIds && options.itemIds.length > 0) {
        skippedCount = options.itemIds.length - items.length;
    } else if (options.batchId) {
        const row = db.prepare(
            `SELECT COUNT(*) as count FROM account_issuance_items WHERE batch_id = ? AND can_download_password = 0`
        ).get(options.batchId) as { count: number };
        skippedCount = row.count;
    }

    return { items, skippedCount };
};

export const buildIssuanceWorkbookBuffer = (
    items: DownloadableIssuanceItem[],
    loginUrl: string
): Buffer => {
    const worksheet = XLSX.utils.json_to_sheet(
        items.map((item) => ({
            登录入口: loginUrl,
            登录账号: item.username,
            一次性密码: decryptPassword(item),
            身份: item.role,
            姓名: item.displayName,
            关联信息: item.relatedName ?? "--",
            学号: item.studentNo ?? "--",
            班级: item.className ?? "--",
            任教学科: item.subjectName ?? "--",
            首次登录说明: "请登录后立即修改密码"
        }))
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "账号发放");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
