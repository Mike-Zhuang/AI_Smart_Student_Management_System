import dayjs from "dayjs";
import { securityConfig } from "../config/security.js";
import { db } from "../db.js";
import type { AuthUser } from "../types.js";
import { buildRefreshToken, setRefreshTokenCookie, sha256, signAccessToken, verifyRefreshToken } from "./auth.js";

type SessionRow = {
    id: number;
    userId: number;
    refreshTokenHash: string;
    expiresAt: string;
    revokedAt: string | null;
    replaceBySessionId: number | null;
    createdAt: string;
};

const getSessionById = (sessionId: number): SessionRow | undefined =>
    db.prepare(
        `SELECT id,
                user_id as userId,
                refresh_token_hash as refreshTokenHash,
                expires_at as expiresAt,
                revoked_at as revokedAt,
                replace_by_session_id as replaceBySessionId,
                created_at as createdAt
         FROM auth_sessions
         WHERE id = ?`
    ).get(sessionId) as SessionRow | undefined;

export const createSessionForUser = (input: {
    user: AuthUser;
    ipAddress: string;
    userAgent: string;
}): { accessToken: string; refreshToken: string; sessionId: number } => {
    const now = dayjs().toISOString();
    const result = db.prepare(
        `INSERT INTO auth_sessions (
            user_id,
            refresh_token_hash,
            ip_address,
            user_agent,
            expires_at,
            last_used_at,
            created_at,
            updated_at
        )
        VALUES (?, '', ?, ?, ?, ?, ?, ?)`
    ).run(
        input.user.id,
        input.ipAddress,
        input.userAgent,
        dayjs(now).add(securityConfig.refreshTokenTtlDays, "day").toISOString(),
        now,
        now,
        now
    );

    const sessionId = Number(result.lastInsertRowid);
    const refreshToken = buildRefreshToken(sessionId);
    db.prepare(
        `UPDATE auth_sessions
         SET refresh_token_hash = ?, updated_at = ?
         WHERE id = ?`
    ).run(sha256(refreshToken), now, sessionId);

    return {
        sessionId,
        refreshToken,
        accessToken: signAccessToken({ sessionId, user: input.user })
    };
};

export const revokeSessionById = (sessionId: number, reason: string): void => {
    db.prepare(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, ?),
             revoke_reason = COALESCE(revoke_reason, ?),
             updated_at = ?
         WHERE id = ?`
    ).run(dayjs().toISOString(), reason, dayjs().toISOString(), sessionId);
};

export const revokeAllSessionsForUser = (userId: number, reason: string, exceptSessionId?: number): number => {
    const now = dayjs().toISOString();
    const result = exceptSessionId
        ? db.prepare(
            `UPDATE auth_sessions
             SET revoked_at = COALESCE(revoked_at, ?),
                 revoke_reason = COALESCE(revoke_reason, ?),
                 updated_at = ?
             WHERE user_id = ? AND revoked_at IS NULL AND id != ?`
        ).run(now, reason, now, userId, exceptSessionId)
        : db.prepare(
            `UPDATE auth_sessions
             SET revoked_at = COALESCE(revoked_at, ?),
                 revoke_reason = COALESCE(revoke_reason, ?),
                 updated_at = ?
             WHERE user_id = ? AND revoked_at IS NULL`
        ).run(now, reason, now, userId);
    return result.changes;
};

export const validateSessionForAccess = (sessionId: number, userId: number): { ok: boolean; reason?: string; session?: SessionRow } => {
    const session = getSessionById(sessionId);
    if (!session || session.userId !== userId) {
        return { ok: false, reason: "会话不存在" };
    }

    if (session.revokedAt) {
        return { ok: false, reason: "会话已失效", session };
    }

    if (dayjs(session.expiresAt).isBefore(dayjs())) {
        return { ok: false, reason: "会话已过期", session };
    }

    return { ok: true, session };
};

export const rotateRefreshSession = (refreshToken: string, nextUser: AuthUser, context: {
    ipAddress: string;
    userAgent: string;
}): { accessToken: string; refreshToken: string; sessionId: number } | null => {
    const parsed = verifyRefreshToken(refreshToken);
    if (!parsed) {
        return null;
    }

    const session = getSessionById(parsed.sessionId);
    if (!session || session.userId !== nextUser.id) {
        return null;
    }

    if (session.revokedAt || session.replaceBySessionId || dayjs(session.expiresAt).isBefore(dayjs())) {
        return null;
    }

    if (sha256(parsed.token) !== session.refreshTokenHash) {
        return null;
    }

    const next = createSessionForUser({
        user: nextUser,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
    });

    db.prepare(
        `UPDATE auth_sessions
         SET revoked_at = ?, revoke_reason = ?, replace_by_session_id = ?, updated_at = ?
         WHERE id = ?`
    ).run(dayjs().toISOString(), "rotated", next.sessionId, dayjs().toISOString(), session.id);

    return next;
};

export const issueTokensAndCookie = (
    user: AuthUser,
    res: import("express").Response,
    context: { ipAddress: string; userAgent: string }
): { accessToken: string; sessionId: number } => {
    const session = createSessionForUser({
        user,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
    });
    setRefreshTokenCookie(res, session.refreshToken);
    return {
        accessToken: session.accessToken,
        sessionId: session.sessionId
    };
};
