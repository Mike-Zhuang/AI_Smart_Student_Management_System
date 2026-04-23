import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import { securityConfig } from "../config/security.js";
import type { AuthUser } from "../types.js";

const ACCESS_SECRET = securityConfig.accessTokenSecret;
const REFRESH_SECRET = securityConfig.refreshTokenSecret;
const REFRESH_COOKIE_NAME = "ms_refresh_token";
const DEFAULT_COOKIE_PATH = "/api/auth";
const REFRESH_TOKEN_AUDIENCE = "management-system-refresh";
const ACCESS_TOKEN_AUDIENCE = "management-system-access";
const JWT_ISSUER = "management-system-backend";

export const hashPassword = (plain: string): string => bcrypt.hashSync(plain, 10);

export const comparePassword = (plain: string, hashed: string): boolean => bcrypt.compareSync(plain, hashed);

export const generateTemporaryPassword = (length = 12): string => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%";
  const bytes = randomBytes(length);
  let password = "";

  for (let index = 0; index < length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }

  return password;
};

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const secureCompare = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const generateOpaqueToken = (size = 48): string => randomBytes(size).toString("base64url");

export type AccessTokenPayload = {
  sessionId: number;
  user: AuthUser;
};

export const signAccessToken = (payload: AccessTokenPayload): string => {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: `${securityConfig.accessTokenTtlMinutes}m`,
    issuer: JWT_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE
  });
};

export const verifyAccessToken = (token: string): AccessTokenPayload | null => {
  try {
    return jwt.verify(token, ACCESS_SECRET, {
      issuer: JWT_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE
    }) as AccessTokenPayload;
  } catch {
    return null;
  }
};

export type RefreshTokenPayload = {
  sessionId: number;
  token: string;
};

export const buildRefreshToken = (sessionId: number): string => {
  const nonce = generateOpaqueToken(32);
  const signature = jwt.sign({ sessionId, nonce }, REFRESH_SECRET, {
    expiresIn: `${securityConfig.refreshTokenTtlDays}d`,
    issuer: JWT_ISSUER,
    audience: REFRESH_TOKEN_AUDIENCE
  });
  return `${sessionId}.${nonce}.${signature}`;
};

export const verifyRefreshToken = (refreshToken: string): RefreshTokenPayload | null => {
  const parts = refreshToken.split(".");
  if (parts.length < 4) {
    return null;
  }

  const sessionId = Number(parts[0]);
  const nonce = parts[1];
  const signature = parts.slice(2).join(".");
  if (Number.isNaN(sessionId) || sessionId <= 0 || !nonce) {
    return null;
  }

  try {
    const decoded = jwt.verify(signature, REFRESH_SECRET, {
      issuer: JWT_ISSUER,
      audience: REFRESH_TOKEN_AUDIENCE
    }) as { sessionId: number; nonce: string };

    if (decoded.sessionId !== sessionId || !secureCompare(decoded.nonce, nonce)) {
      return null;
    }

    return { sessionId, token: refreshToken };
  } catch {
    return null;
  }
};

export const setRefreshTokenCookie = (res: Response, refreshToken: string): void => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: securityConfig.cookieSecure,
    domain: securityConfig.cookieDomain,
    maxAge: securityConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    path: DEFAULT_COOKIE_PATH
  });
};

export const clearRefreshTokenCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: securityConfig.cookieSecure,
    domain: securityConfig.cookieDomain,
    path: DEFAULT_COOKIE_PATH
  });
};

export const parseCookieHeader = (cookieHeader: string | undefined, key: string): string | null => {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";").map((item) => item.trim());
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name !== key) {
      continue;
    }
    return decodeURIComponent(part.slice(separator + 1));
  }

  return null;
};

export const getRefreshTokenFromCookie = (cookieHeader: string | undefined): string | null =>
  parseCookieHeader(cookieHeader, REFRESH_COOKIE_NAME);

export const getRefreshCookieName = (): string => REFRESH_COOKIE_NAME;
