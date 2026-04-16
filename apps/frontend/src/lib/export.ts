import { storage } from "./storage";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

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
  const response = await fetch(`${API_BASE}${target}`, {
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
