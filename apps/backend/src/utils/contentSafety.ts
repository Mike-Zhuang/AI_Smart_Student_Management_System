import { SENSITIVE_RULES, type SensitiveCategory } from "../config/sensitiveWords.js";
import { securityConfig } from "../config/security.js";
import { repairText } from "./text.js";

export type SensitiveHit = {
    category: SensitiveCategory;
    label: string;
    matchedText: string;
};

export const normalizeSecurityText = (value: unknown): string => {
    const repaired = repairText(value);
    return repaired.normalize("NFKC").replace(/\s+/g, " ").trim();
};

export const validatePlainInput = (
    value: unknown,
    options: {
        fieldName: string;
        required?: boolean;
        maxLength?: number;
        pattern?: RegExp;
    }
): string => {
    const normalized = normalizeSecurityText(value);
    if (!normalized) {
        if (options.required) {
            throw new Error(`${options.fieldName}不能为空`);
        }
        return "";
    }

    const maxLength = options.maxLength ?? securityConfig.textFieldMaxLength;
    if (normalized.length > maxLength) {
        throw new Error(`${options.fieldName}长度不能超过${maxLength}个字符`);
    }

    if (options.pattern && !options.pattern.test(normalized)) {
        throw new Error(`${options.fieldName}格式不合法`);
    }

    if (/[\u0000-\u001F\u007F]/.test(normalized)) {
        throw new Error(`${options.fieldName}包含非法控制字符`);
    }

    return normalized;
};

export const checkSensitiveText = (value: unknown): SensitiveHit | null => {
    const normalized = normalizeSecurityText(value);
    if (!normalized) {
        return null;
    }

    for (const rule of SENSITIVE_RULES) {
        for (const pattern of rule.patterns) {
            const matched = normalized.match(pattern);
            if (matched?.[0]) {
                return {
                    category: rule.category,
                    label: rule.label,
                    matchedText: matched[0].slice(0, 20)
                };
            }
        }
    }

    return null;
};

export const assertSafeBusinessText = (
    value: unknown,
    options: {
        fieldName: string;
        required?: boolean;
        maxLength?: number;
    }
): string => {
    const normalized = validatePlainInput(value, options);
    if (!normalized) {
        return "";
    }

    const hit = checkSensitiveText(normalized);
    if (hit) {
        throw new Error(`${options.fieldName}包含不允许提交的${hit.label}内容`);
    }

    return normalized;
};

export const assertSafeBusinessTextMap = <T extends Record<string, unknown>>(
    payload: T,
    fields: Array<keyof T>,
    fieldLabels: Partial<Record<keyof T, string>>
): T => {
    const next = { ...payload };
    for (const field of fields) {
        const value = payload[field];
        if (value === undefined || value === null || value === "") {
            continue;
        }

        next[field] = assertSafeBusinessText(value, {
            fieldName: fieldLabels[field] ?? String(field),
            required: false
        }) as T[keyof T];
    }
    return next;
};
