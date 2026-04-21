import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import type { AuthUser } from "../types.js";

const SECRET = process.env.JWT_SECRET || "dev-secret";

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

export const signToken = (user: AuthUser): string => {
  return jwt.sign({ user }, SECRET, { expiresIn: "12h" });
};

export const verifyToken = (token: string): AuthUser | null => {
  try {
    const decoded = jwt.verify(token, SECRET) as { user: AuthUser };
    return decoded.user;
  } catch {
    return null;
  }
};
