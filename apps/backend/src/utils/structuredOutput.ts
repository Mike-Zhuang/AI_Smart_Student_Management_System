const fencedJsonPattern = /```json\s*([\s\S]*?)```/i;
const fencedCodePattern = /```\s*([\s\S]*?)```/i;

export type StructuredOutputErrorType =
    | "TRUNCATED_OUTPUT"
    | "INVALID_JSON"
    | "EMPTY_FINAL_CONTENT";

const tryParse = (value: string): Record<string, unknown> | null => {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
};

const extractBalancedJsonObject = (value: string): string | null => {
    // 这里做轻量级括号配平，是为了兼容模型先输出说明文字、后输出 JSON 片段的常见情况。
    let startIndex = -1;
    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let index = 0; index < value.length; index += 1) {
        const current = value[index];

        if (startIndex === -1) {
            if (current === "{") {
                startIndex = index;
                depth = 1;
            }
            continue;
        }

        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }
            if (current === "\\") {
                escaping = true;
                continue;
            }
            if (current === "\"") {
                inString = false;
            }
            continue;
        }

        if (current === "\"") {
            inString = true;
            continue;
        }

        if (current === "{") {
            depth += 1;
            continue;
        }

        if (current === "}") {
            depth -= 1;
            if (depth === 0) {
                return value.slice(startIndex, index + 1);
            }
        }
    }

    return null;
};

const normalizeCommonJsonIssues = (value: string): string => {
    return value
        .replace(/^\uFEFF/, "")
        .replace(/，/g, ",")
        .replace(/：/g, ":")
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .trim();
};

const isLikelyTruncatedJson = (value: string): boolean => {
    const normalized = normalizeCommonJsonIssues(value);
    if (!normalized || !normalized.includes("{")) {
        return false;
    }

    let depth = 0;
    let inString = false;
    let escaping = false;

    for (const current of normalized) {
        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }
            if (current === "\\") {
                escaping = true;
                continue;
            }
            if (current === "\"") {
                inString = false;
            }
            continue;
        }

        if (current === "\"") {
            inString = true;
            continue;
        }

        if (current === "{") {
            depth += 1;
            continue;
        }

        if (current === "}") {
            depth -= 1;
        }
    }

    return depth > 0 || /[:,"\[]\s*$/.test(normalized);
};

export const parseStructuredJson = (raw: string): {
    parsed: Record<string, unknown> | null;
    source: string;
    repaired: boolean;
    errorType?: StructuredOutputErrorType;
    error?: string;
} => {
    const trimmed = raw.trim();
    if (!trimmed) {
        return {
            parsed: null,
            source: "",
            repaired: false,
            errorType: "EMPTY_FINAL_CONTENT",
            error: "模型未返回最终正文"
        };
    }

    const candidates = [
        trimmed,
        trimmed.match(fencedJsonPattern)?.[1]?.trim(),
        trimmed.match(fencedCodePattern)?.[1]?.trim(),
        extractBalancedJsonObject(trimmed)
    ].filter((item): item is string => Boolean(item && item.trim()));

    for (const candidate of candidates) {
        const direct = tryParse(candidate);
        if (direct) {
            return { parsed: direct, source: candidate, repaired: false };
        }

        const repairedCandidate = normalizeCommonJsonIssues(candidate);
        const repaired = tryParse(repairedCandidate);
        if (repaired) {
            return { parsed: repaired, source: repairedCandidate, repaired: true };
        }
    }

    return {
        parsed: null,
        source: trimmed,
        repaired: false,
        errorType: isLikelyTruncatedJson(trimmed) ? "TRUNCATED_OUTPUT" : "INVALID_JSON",
        error: isLikelyTruncatedJson(trimmed) ? "模型输出被截断，未返回完整 JSON" : "模型返回内容未能解析为合法 JSON"
    };
};
