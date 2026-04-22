import type { db as databaseInstance } from "../db.js";
import { ROLES } from "../constants.js";
import { hashPassword } from "./auth.js";

type SqliteDatabase = typeof databaseInstance;

const getOrCreateAuditKeeperUserId = (db: SqliteDatabase): number => {
    const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get("__system_audit__") as { id: number } | undefined;
    if (existing) {
        return existing.id;
    }

    const now = new Date().toISOString();
    const result = db.prepare(
        `INSERT INTO users (username, password_hash, display_name, role, created_at, must_change_password, is_active)
         VALUES (?, ?, ?, ?, ?, 0, 1)`
    ).run("__system_audit__", hashPassword("system-audit-lock"), "系统审计保留", ROLES.ADMIN, now);

    return Number(result.lastInsertRowid);
};

const deleteEmptyIssuanceBatches = (db: SqliteDatabase, batchIds: number[]): void => {
    if (batchIds.length === 0) {
        return;
    }

    const uniqueBatchIds = [...new Set(batchIds)];
    const placeholders = uniqueBatchIds.map(() => "?").join(",");
    db.prepare(
        `DELETE FROM account_issuance_batches
         WHERE id IN (${placeholders})
           AND id NOT IN (SELECT DISTINCT batch_id FROM account_issuance_items)`
    ).run(...uniqueBatchIds);
};

export const purgeIssuanceArtifactsForUser = (db: SqliteDatabase, userId: number): void => {
    const batchRows = db.prepare(
        `SELECT DISTINCT batch_id as batchId
         FROM account_issuance_items
         WHERE user_id = ?`
    ).all(userId) as Array<{ batchId: number }>;

    db.prepare(`DELETE FROM account_issuance_items WHERE user_id = ?`).run(userId);
    deleteEmptyIssuanceBatches(
        db,
        batchRows.map((item) => item.batchId)
    );
};

export const deleteUserWithIssuance = (db: SqliteDatabase, userId: number): void => {
    const auditKeeperUserId = getOrCreateAuditKeeperUserId(db);
    db.prepare(
        `UPDATE account_issuance_batches
         SET operator_user_id = ?
         WHERE operator_user_id = ?`
    ).run(auditKeeperUserId, userId);
    purgeIssuanceArtifactsForUser(db, userId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
};
