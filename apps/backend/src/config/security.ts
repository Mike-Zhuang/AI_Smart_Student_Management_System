const toNumber = (value: string | undefined, fallback: number, options?: { min?: number; max?: number }): number => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        return fallback;
    }

    let next = parsed;
    if (typeof options?.min === "number") {
        next = Math.max(options.min, next);
    }
    if (typeof options?.max === "number") {
        next = Math.min(options.max, next);
    }
    return next;
};

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
    if (!value) {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
        return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
        return false;
    }
    return fallback;
};

const splitCsv = (value: string | undefined): string[] => {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
};

export const isProduction = process.env.NODE_ENV === "production";

export const securityConfig = {
    trustProxy: process.env.TRUST_PROXY?.trim() || "loopback",
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || "dev-access-token-secret-change-me",
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET || "dev-refresh-token-secret-change-me",
    accessTokenTtlMinutes: toNumber(process.env.ACCESS_TOKEN_TTL_MINUTES, 15, { min: 5, max: 120 }),
    refreshTokenTtlDays: toNumber(process.env.REFRESH_TOKEN_TTL_DAYS, 7, { min: 1, max: 30 }),
    cookieDomain: process.env.COOKIE_DOMAIN?.trim() || undefined,
    cookieSecure: toBoolean(process.env.COOKIE_SECURE, isProduction),
    allowedOrigins: splitCsv(process.env.ALLOWED_ORIGINS),
    globalReadRateLimitPerMinute: toNumber(process.env.READ_RATE_LIMIT_PER_MINUTE, 240, { min: 30, max: 5000 }),
    globalWriteRateLimitPerMinute: toNumber(process.env.WRITE_RATE_LIMIT_PER_MINUTE, 120, { min: 10, max: 2000 }),
    aiRateLimitPerMinute: toNumber(process.env.AI_RATE_LIMIT_PER_MINUTE, 30, { min: 2, max: 300 }),
    uploadRateLimitPerMinute: toNumber(process.env.UPLOAD_RATE_LIMIT_PER_MINUTE, 20, { min: 1, max: 120 }),
    authRateLimitPerMinute: toNumber(process.env.AUTH_RATE_LIMIT_PER_MINUTE, 40, { min: 5, max: 300 }),
    authIpWindowMinutes: toNumber(process.env.AUTH_RATE_LIMIT_IP_WINDOW_MINUTES, 15, { min: 1, max: 120 }),
    authIpMaxAttempts: toNumber(process.env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS, 25, { min: 3, max: 500 }),
    authUserIpWindowMinutes: toNumber(process.env.AUTH_RATE_LIMIT_USER_IP_WINDOW_MINUTES, 15, { min: 1, max: 120 }),
    authUserIpMaxAttempts: toNumber(process.env.AUTH_RATE_LIMIT_USER_IP_MAX_ATTEMPTS, 8, { min: 2, max: 100 }),
    authLockWindowMinutes: toNumber(process.env.AUTH_LOCK_WINDOW_MINUTES, 30, { min: 5, max: 240 }),
    authLockMaxFailures: toNumber(process.env.AUTH_LOCK_MAX_FAILURES, 8, { min: 3, max: 50 }),
    authLockMinutes: toNumber(process.env.AUTH_LOCK_MINUTES, 20, { min: 1, max: 240 }),
    riskChallengeTtlSeconds: toNumber(process.env.RISK_CHALLENGE_TTL_SECONDS, 300, { min: 60, max: 1800 }),
    authMinSubmitDelayMs: toNumber(process.env.AUTH_MIN_SUBMIT_DELAY_MS, 800, { min: 0, max: 10000 }),
    uploadMaxBytes: toNumber(process.env.UPLOAD_MAX_BYTES, 8 * 1024 * 1024, { min: 1024 * 1024, max: 20 * 1024 * 1024 }),
    importMaxRows: toNumber(process.env.IMPORT_MAX_ROWS, 3000, { min: 50, max: 20000 }),
    importMaxCellLength: toNumber(process.env.IMPORT_MAX_CELL_LENGTH, 400, { min: 20, max: 4000 }),
    textFieldMaxLength: toNumber(process.env.TEXT_FIELD_MAX_LENGTH, 2000, { min: 64, max: 10000 }),
    auditQueryMaxLimit: toNumber(process.env.AUDIT_QUERY_MAX_LIMIT, 500, { min: 50, max: 5000 })
};

export const ACCESS_TOKEN_COOKIELESS_BUFFER_SECONDS = 15;
