import type { NextFunction, Request, Response } from "express";
import { securityConfig } from "../config/security.js";

type AttemptBucket = {
    timestamps: number[];
};

type RateLimitPolicy = {
    name: string;
    limit: number;
    windowMs: number;
    message: string;
    keyFn?: (req: Request) => string;
};

const policyBuckets = new Map<string, AttemptBucket>();
const authIpBuckets = new Map<string, AttemptBucket>();
const authUserIpBuckets = new Map<string, AttemptBucket>();

const getNow = (): number => Date.now();

const sanitizeBucket = (bucket: AttemptBucket, windowMs: number, now: number): AttemptBucket => {
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp <= windowMs);
    return bucket;
};

const getBucket = (store: Map<string, AttemptBucket>, key: string, windowMs: number, now: number): AttemptBucket => {
    const current = store.get(key) ?? { timestamps: [] };
    const sanitized = sanitizeBucket(current, windowMs, now);
    store.set(key, sanitized);
    return sanitized;
};

const getRequestIp = (req: Request): string => req.ip || "unknown";

const getUserIpKey = (username: string, ipAddress: string): string => `${username.toLowerCase()}::${ipAddress}`;

const countAttempts = (store: Map<string, AttemptBucket>, key: string, windowMs: number): number => {
    const bucket = getBucket(store, key, windowMs, getNow());
    return bucket.timestamps.length;
};

const pushAttempt = (store: Map<string, AttemptBucket>, key: string, windowMs: number): number => {
    const now = getNow();
    const bucket = getBucket(store, key, windowMs, now);
    bucket.timestamps.push(now);
    return bucket.timestamps.length;
};

const buildMiddleware = (policy: RateLimitPolicy) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const key = `${policy.name}:${policy.keyFn ? policy.keyFn(req) : getRequestIp(req)}`;
        const now = getNow();
        const bucket = getBucket(policyBuckets, key, policy.windowMs, now);
        if (bucket.timestamps.length >= policy.limit) {
            res.status(429).json({ success: false, message: policy.message });
            return;
        }
        bucket.timestamps.push(now);
        next();
    };
};

const readSoftPolicy: RateLimitPolicy = {
    name: "read-soft",
    limit: securityConfig.globalReadRateLimitPerMinute,
    windowMs: 60 * 1000,
    message: "读取请求过于频繁，请稍后再试"
};

const writeMediumPolicy: RateLimitPolicy = {
    name: "write-medium",
    limit: securityConfig.globalWriteRateLimitPerMinute,
    windowMs: 60 * 1000,
    message: "写入请求过于频繁，请稍后再试"
};

const aiHeavyPolicy: RateLimitPolicy = {
    name: "ai-heavy",
    limit: securityConfig.aiRateLimitPerMinute,
    windowMs: 60 * 1000,
    message: "AI 请求过于频繁，请稍后再试"
};

const uploadStrictPolicy: RateLimitPolicy = {
    name: "upload-strict",
    limit: securityConfig.uploadRateLimitPerMinute,
    windowMs: 60 * 1000,
    message: "上传操作过于频繁，请稍后再试"
};

const authStrictPolicy: RateLimitPolicy = {
    name: "auth-strict",
    limit: securityConfig.authRateLimitPerMinute,
    windowMs: 60 * 1000,
    message: "认证请求过于频繁，请稍后再试"
};

export const globalRequestRateLimit = (req: Request, res: Response, next: NextFunction): void => {
    const middleware = ["GET", "HEAD", "OPTIONS"].includes(req.method) ? buildMiddleware(readSoftPolicy) : buildMiddleware(writeMediumPolicy);
    middleware(req, res, next);
};

export const aiRateLimit = buildMiddleware(aiHeavyPolicy);
export const uploadRateLimit = buildMiddleware(uploadStrictPolicy);
export const authRouteRateLimit = buildMiddleware(authStrictPolicy);

export const getAuthRiskState = (username: string, ipAddress: string): {
    ipAttempts: number;
    userIpAttempts: number;
    challengeRequired: boolean;
} => {
    const ipWindowMs = securityConfig.authIpWindowMinutes * 60 * 1000;
    const userIpWindowMs = securityConfig.authUserIpWindowMinutes * 60 * 1000;
    const ipAttempts = countAttempts(authIpBuckets, ipAddress, ipWindowMs);
    const userIpAttempts = countAttempts(authUserIpBuckets, getUserIpKey(username, ipAddress), userIpWindowMs);
    const challengeRequired =
        ipAttempts >= Math.max(3, Math.floor(securityConfig.authIpMaxAttempts / 3)) ||
        userIpAttempts >= Math.max(2, Math.floor(securityConfig.authUserIpMaxAttempts / 2));

    return { ipAttempts, userIpAttempts, challengeRequired };
};

export const assertAuthAttemptAllowed = (username: string, ipAddress: string): void => {
    const ipWindowMs = securityConfig.authIpWindowMinutes * 60 * 1000;
    const userIpWindowMs = securityConfig.authUserIpWindowMinutes * 60 * 1000;

    const ipAttempts = countAttempts(authIpBuckets, ipAddress, ipWindowMs);
    if (ipAttempts >= securityConfig.authIpMaxAttempts) {
        throw new Error("登录尝试过于频繁，请稍后再试");
    }

    const userIpAttempts = countAttempts(authUserIpBuckets, getUserIpKey(username, ipAddress), userIpWindowMs);
    if (userIpAttempts >= securityConfig.authUserIpMaxAttempts) {
        throw new Error("当前账号登录尝试过于频繁，请稍后再试");
    }
};

export const recordAuthFailure = (username: string, ipAddress: string): { ipAttempts: number; userIpAttempts: number } => {
    const ipAttempts = pushAttempt(authIpBuckets, ipAddress, securityConfig.authIpWindowMinutes * 60 * 1000);
    const userIpAttempts = pushAttempt(
        authUserIpBuckets,
        getUserIpKey(username, ipAddress),
        securityConfig.authUserIpWindowMinutes * 60 * 1000
    );
    return { ipAttempts, userIpAttempts };
};

export const clearAuthFailures = (username: string, ipAddress: string): void => {
    authUserIpBuckets.delete(getUserIpKey(username, ipAddress));
};
