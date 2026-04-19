import { storage } from "./storage";
import type { ApiEnvelope } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").trim();

export const resolveApiUrl = (path: string): string => {
  const normalizedBase = API_BASE.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedBase.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${normalizedBase}${normalizedPath.slice(4)}`;
  }

  return `${normalizedBase}${normalizedPath}`;
};

type RequestInitEx = RequestInit & { skipAuth?: boolean };

export async function apiRequest<T>(path: string, init: RequestInitEx = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  const isFormDataBody = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (!isFormDataBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const requestUrl = resolveApiUrl(path);

  if (!init.skipAuth) {
    const token = storage.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(requestUrl, {
    ...init,
    headers
  });

  const raw = await response.text();
  let body: ApiEnvelope<T>;
  try {
    body = JSON.parse(raw) as ApiEnvelope<T>;
  } catch {
    throw new Error(response.ok ? "服务返回格式异常" : "请求失败，请检查服务配置");
  }

  if (!response.ok || !body.success) {
    throw new Error(body.message || "请求失败");
  }

  return body;
}
