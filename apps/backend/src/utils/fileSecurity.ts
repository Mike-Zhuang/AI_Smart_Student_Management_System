import path from "node:path";
import { securityConfig } from "../config/security.js";
import { repairText } from "./text.js";

type UploadCategory = "ai-image" | "wellbeing-attachment" | "gallery-image" | "data-import";

const DANGEROUS_EXTENSIONS = new Set([
    ".html",
    ".htm",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".sh",
    ".bash",
    ".zsh",
    ".exe",
    ".dll",
    ".bat",
    ".cmd",
    ".php",
    ".jsp",
    ".asp",
    ".aspx",
    ".svg"
]);

const ALLOWED_EXTENSIONS: Record<UploadCategory, string[]> = {
    "ai-image": [".png", ".jpg", ".jpeg", ".webp", ".gif"],
    "gallery-image": [".png", ".jpg", ".jpeg", ".webp", ".gif"],
    "wellbeing-attachment": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"],
    "data-import": [".csv", ".xlsx"]
};

const ALLOWED_MIME_PREFIXES: Record<UploadCategory, string[]> = {
    "ai-image": ["image/png", "image/jpeg", "image/webp", "image/gif"],
    "gallery-image": ["image/png", "image/jpeg", "image/webp", "image/gif"],
    "wellbeing-attachment": [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "application/octet-stream"
    ],
    "data-import": [
        "text/csv",
        "application/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream",
        "application/zip",
        "text/plain"
    ]
};

const hasSignature = (buffer: Buffer, signature: number[]): boolean => {
    if (buffer.length < signature.length) {
        return false;
    }
    return signature.every((byte, index) => buffer[index] === byte);
};

const detectFileKind = (buffer: Buffer): "png" | "jpg" | "gif" | "webp" | "pdf" | "zip" | "text" | "unknown" => {
    if (hasSignature(buffer, [0x89, 0x50, 0x4e, 0x47])) {
        return "png";
    }
    if (hasSignature(buffer, [0xff, 0xd8, 0xff])) {
        return "jpg";
    }
    if (hasSignature(buffer, [0x47, 0x49, 0x46, 0x38])) {
        return "gif";
    }
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        return "webp";
    }
    if (hasSignature(buffer, [0x25, 0x50, 0x44, 0x46])) {
        return "pdf";
    }
    if (hasSignature(buffer, [0x50, 0x4b, 0x03, 0x04])) {
        return "zip";
    }

    const asciiPrefix = buffer.subarray(0, 64).toString("utf8");
    if (!/[^\x09\x0A\x0D\x20-\x7E\u4e00-\u9fa5]/.test(asciiPrefix)) {
        return "text";
    }
    return "unknown";
};

const SIGNATURE_BY_EXTENSION: Partial<Record<string, Array<ReturnType<typeof detectFileKind>>>> = {
    ".png": ["png"],
    ".jpg": ["jpg"],
    ".jpeg": ["jpg"],
    ".gif": ["gif"],
    ".webp": ["webp"],
    ".pdf": ["pdf"],
    ".docx": ["zip"],
    ".xlsx": ["zip"],
    ".pptx": ["zip"],
    ".csv": ["text"],
    ".txt": ["text"]
};

export const createMulterFileSizeLimit = (): number => securityConfig.uploadMaxBytes;

export const sanitizeOriginalFilename = (value: string): string => {
    const normalized = repairText(path.basename(value))
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
    return normalized.slice(0, 120) || "file";
};

export const assertSafeUploadFile = (
    file: Express.Multer.File | undefined,
    category: UploadCategory
): { sanitizedName: string; extension: string } => {
    if (!file) {
        throw new Error("缺少上传文件");
    }

    if (file.size <= 0 || file.size > createMulterFileSizeLimit()) {
        throw new Error("上传文件大小不合法");
    }

    const sanitizedName = sanitizeOriginalFilename(file.originalname);
    const extension = path.extname(sanitizedName).toLowerCase();
    const lowerName = sanitizedName.toLowerCase();

    if (!extension) {
        throw new Error("上传文件缺少合法后缀");
    }

    if (DANGEROUS_EXTENSIONS.has(extension)) {
        throw new Error("该文件类型不允许上传");
    }

    if (!ALLOWED_EXTENSIONS[category].includes(extension)) {
        throw new Error("上传文件类型不在允许范围内");
    }

    if (lowerName.split(".").length > 2 && [...DANGEROUS_EXTENSIONS].some((item) => lowerName.includes(`${item}.`))) {
        throw new Error("检测到可疑双扩展名文件");
    }

    const mime = file.mimetype.toLowerCase();
    if (!ALLOWED_MIME_PREFIXES[category].includes(mime)) {
        throw new Error("上传文件 MIME 类型不在允许范围内");
    }

    const detectedKind = detectFileKind(file.buffer);
    const expectedKinds = SIGNATURE_BY_EXTENSION[extension];
    if (expectedKinds && !expectedKinds.includes(detectedKind)) {
        throw new Error("上传文件内容与扩展名不匹配");
    }

    return { sanitizedName, extension };
};
