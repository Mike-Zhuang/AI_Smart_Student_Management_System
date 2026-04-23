import { fetchWithAuth } from "./api";

const triggerBrowserDownload = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
};

export const downloadExport = async (
    endpoint: string,
    filenamePrefix: string,
    format: "csv" | "json" = "csv"
): Promise<void> => {
    const target = endpoint.includes("?") ? `${endpoint}&format=${format}` : `${endpoint}?format=${format}`;
    const response = await fetchWithAuth(target);

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "导出失败");
    }

    const blob = await response.blob();
    triggerBrowserDownload(blob, `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.${format}`);
};

export const downloadFile = async (endpoint: string, fallbackFilename: string): Promise<void> => {
    const response = await fetchWithAuth(endpoint);

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "下载失败");
    }

    const disposition = response.headers.get("Content-Disposition") ?? "";
    const matched = disposition.match(/filename="?([^\"]+)"?/i);
    const filename = matched?.[1] ?? fallbackFilename;

    const blob = await response.blob();
    triggerBrowserDownload(blob, filename);
};

export const downloadPostFile = async (
    endpoint: string,
    body: unknown,
    fallbackFilename: string
): Promise<{ skippedCount: number }> => {
    const response = await fetchWithAuth(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const raw = await response.text();
        try {
            const parsed = JSON.parse(raw) as { message?: string };
            throw new Error(parsed.message ?? "下载失败");
        } catch {
            throw new Error(raw || "下载失败");
        }
    }

    const disposition = response.headers.get("Content-Disposition") ?? "";
    const matched = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^\"]+)"?/i);
    const filename = decodeURIComponent(matched?.[1] ?? matched?.[2] ?? fallbackFilename);
    const skippedCount = Number(response.headers.get("X-Skipped-Count") ?? "0");

    const blob = await response.blob();
    triggerBrowserDownload(blob, filename);
    return { skippedCount };
};
