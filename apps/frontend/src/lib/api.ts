import { storage } from "./storage";
import type { ApiEnvelope, User } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").trim();
let refreshPromise: Promise<User | null> | null = null;

export const resolveApiUrl = (path: string): string => {
  const normalizedBase = API_BASE.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedBase.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${normalizedBase}${normalizedPath.slice(4)}`;
  }

  return `${normalizedBase}${normalizedPath}`;
};

type RequestInitEx = RequestInit & {
  skipAuth?: boolean;
  skipRefreshRetry?: boolean;
};

const handleAuthExpired = (): void => {
  storage.clearAuth();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
};

const parseEnvelope = <T>(raw: string): ApiEnvelope<T> => JSON.parse(raw) as ApiEnvelope<T>;

export const tryRefreshAccessToken = async (): Promise<User | null> => {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const response = await fetch(resolveApiUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      handleAuthExpired();
      return null;
    }

    const raw = await response.text();
    let body: ApiEnvelope<{ token: string; user?: User }>;
    try {
      body = parseEnvelope(raw);
    } catch {
      handleAuthExpired();
      return null;
    }

    if (!body.success || !body.data?.token) {
      handleAuthExpired();
      return null;
    }

    storage.setToken(body.data.token);
    if (body.data.user) {
      storage.setUser(body.data.user);
      return body.data.user;
    }
    return storage.getUser();
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
};

export async function fetchWithAuth(path: string, init: RequestInitEx = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const isFormDataBody = typeof FormData !== "undefined" && init.body instanceof FormData;
  const requestUrl = resolveApiUrl(path);

  if (!isFormDataBody && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!init.skipAuth) {
    const token = storage.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  let response = await fetch(requestUrl, {
    ...init,
    headers,
    credentials: "include"
  });

  if (response.status === 401 && !init.skipAuth && !init.skipRefreshRetry) {
    const refreshedUser = await tryRefreshAccessToken();
    if (!refreshedUser && !storage.getToken()) {
      return response;
    }

    const retryHeaders = new Headers(init.headers);
    if (!isFormDataBody && init.body && !retryHeaders.has("Content-Type")) {
      retryHeaders.set("Content-Type", "application/json");
    }
    const nextToken = storage.getToken();
    if (nextToken) {
      retryHeaders.set("Authorization", `Bearer ${nextToken}`);
    }

    response = await fetch(requestUrl, {
      ...init,
      headers: retryHeaders,
      credentials: "include"
    });
  }

  if (response.status === 401 && !init.skipAuth) {
    handleAuthExpired();
  }

  return response;
}

export async function apiRequest<T>(path: string, init: RequestInitEx = {}): Promise<ApiEnvelope<T>> {
  const response = await fetchWithAuth(path, init);
  const raw = await response.text();
  let body: ApiEnvelope<T>;
  try {
    body = parseEnvelope(raw);
  } catch {
    throw new Error(response.ok ? "服务返回格式异常" : "请求失败，请检查服务配置");
  }

  if (!response.ok || !body.success) {
    throw new Error(body.message || "请求失败");
  }

  return body;
}

export const bootstrapAuthSession = async (): Promise<User | null> => {
  const token = storage.getToken();
  if (token) {
    try {
      const response = await apiRequest<{ user: User }>("/api/auth/me");
      storage.setUser(response.data.user);
      return response.data.user;
    } catch {
      storage.removeToken();
    }
  }

  const refreshedUser = await tryRefreshAccessToken();
  if (!refreshedUser) {
    return null;
  }

  try {
    const response = await apiRequest<{ user: User }>("/api/auth/me");
    storage.setUser(response.data.user);
    return response.data.user;
  } catch {
    handleAuthExpired();
    return null;
  }
};
