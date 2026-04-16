import type { Request } from "express";
import type { Role } from "./constants.js";

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  linkedStudentId: number | null;
};

export type AuthedRequest = Request & {
  user?: AuthUser;
};

export type ApiResponse<T> = {
  success: boolean;
  message: string;
  data?: T;
};
