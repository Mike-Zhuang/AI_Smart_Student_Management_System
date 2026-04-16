import dayjs from "dayjs";
import type { Request } from "express";
import { db } from "../db.js";

type AuditInput = {
  userId: number;
  actionModule: string;
  actionType: string;
  objectType: string;
  objectId?: number | null;
  detail?: unknown;
  ipAddress?: string;
};

export const extractIp = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || req.ip || "unknown";
  }

  return req.ip || "unknown";
};

export const logAudit = (input: AuditInput): void => {
  try {
    db.prepare(
      `INSERT INTO audit_logs (
         user_id, action_module, action_type, object_type, object_id, detail, ip_address, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.userId,
      input.actionModule,
      input.actionType,
      input.objectType,
      input.objectId ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
      input.ipAddress ?? "unknown",
      dayjs().toISOString()
    );
  } catch {
    // 审计失败不应阻断主业务流程
  }
};
