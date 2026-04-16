import { storage } from "./storage";
import type { ApiEnvelope } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

type RequestInitEx = RequestInit & { skipAuth?: boolean };

export async function apiRequest<T>(path: string, init: RequestInitEx = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  if (!init.skipAuth) {
    const token = storage.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  const body = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !body.success) {
    throw new Error(body.message || "请求失败");
  }

  return body;
}
