import { storage } from "./storage";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").trim();

const buildRequestUrl = (path: string): string => {
    const normalizedBase = API_BASE.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    if (normalizedBase.endsWith("/api") && normalizedPath.startsWith("/api/")) {
        return `${normalizedBase}${normalizedPath.slice(4)}`;
    }

    return `${normalizedBase}${normalizedPath}`;
};

export const downloadExport = async (
    endpoint: string,
    filenamePrefix: string,
    format: "csv" | "json" = "csv"
): Promise<void> => {
    const token = storage.getToken();
    if (!token) {
        throw new Error("请先登录");
    }

    const target = endpoint.includes("?") ? `${endpoint}&format=${format}` : `${endpoint}?format=${format}`;
    const response = await fetch(buildRequestUrl(target), {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "导出失败");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
};

export const downloadFile = async (endpoint: string, fallbackFilename: string): Promise<void> => {
    const token = storage.getToken();
    if (!token) {
        throw new Error("请先登录");
    }

    const response = await fetch(buildRequestUrl(endpoint), {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "下载失败");
    }

    const disposition = response.headers.get("Content-Disposition") ?? "";
    const matched = disposition.match(/filename="?([^\"]+)"?/i);
    const filename = matched?.[1] ?? fallbackFilename;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
};
