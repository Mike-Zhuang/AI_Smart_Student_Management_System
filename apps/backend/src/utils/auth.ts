import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { AuthUser } from "../types.js";

const SECRET = process.env.JWT_SECRET || "dev-secret";

export const hashPassword = (plain: string): string => bcrypt.hashSync(plain, 10);

export const comparePassword = (plain: string, hashed: string): boolean => bcrypt.compareSync(plain, hashed);

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
