export type Role = "admin" | "teacher" | "head_teacher" | "parent" | "student";

export type User = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  linkedStudentId: number | null;
};

export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
};
