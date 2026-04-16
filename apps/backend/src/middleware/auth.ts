import type { NextFunction, Response } from "express";
import { ROLES, type Role } from "../constants.js";
import { db } from "../db.js";
import type { AuthedRequest } from "../types.js";
import { verifyToken } from "../utils/auth.js";

export const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "缺少访问令牌" });
    return;
  }

  const token = header.slice(7);
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ success: false, message: "令牌无效或已过期" });
    return;
  }

  req.user = user;
  next();
};

export const requireRole = (...roles: Role[]) => {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "未登录" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: "无权限访问该资源" });
      return;
    }

    next();
  };
};

export const canAccessStudent = (req: AuthedRequest, studentId: number): boolean => {
  if (!req.user) {
    return false;
  }

  if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.TEACHER || req.user.role === ROLES.HEAD_TEACHER) {
    if (req.user.role === ROLES.ADMIN) {
      return true;
    }

    const teacherAccess = db
      .prepare(
        `SELECT 1
         FROM teacher_class_links tcl
         JOIN students s ON s.class_name = tcl.class_name
         WHERE tcl.teacher_user_id = ? AND s.id = ?
         LIMIT 1`
      )
      .get(req.user.id, studentId);

    return Boolean(teacherAccess);
  }

  if (req.user.role === ROLES.PARENT) {
    const parentAccess = db
      .prepare(
        `SELECT 1
         FROM parent_student_links
         WHERE parent_user_id = ? AND student_id = ?
         LIMIT 1`
      )
      .get(req.user.id, studentId);

    return Boolean(parentAccess);
  }

  if (req.user.role === ROLES.STUDENT) {
    return req.user.linkedStudentId === studentId;
  }

  return false;
};
