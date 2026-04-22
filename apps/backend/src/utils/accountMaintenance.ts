import type { db as databaseInstance } from "../db.js";

type SqliteDatabase = typeof databaseInstance;

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
    purgeIssuanceArtifactsForUser(db, userId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
};
