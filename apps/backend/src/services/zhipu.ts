import axios from "axios";

const ZHIPU_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

type MultiModalItem = {
    type: "text" | "image_url" | "video_url" | "file_url";
    text?: string;
    image_url?: { url: string };
    video_url?: { url: string };
    file_url?: { url: string };
};

export type ChatPayload = {
    apiKey: string;
    model: string;
    prompt: string;
    multimodal?: MultiModalItem[];
    enableThinking?: boolean;
    systemPrompt?: string;
    responseFormat?: "text" | "json_object";
    historyMessages?: Array<{
        role: "user" | "assistant";
        content: string;
    }>;
};

export type ChatResult = {
    content: string;
    reasoning?: string;
};

export class ZhipuCallError extends Error {
    public readonly code:
        | "AUTH_ERROR"
        | "MODEL_ERROR"
        | "TIMEOUT"
        | "NETWORK_ERROR"
        | "EMPTY_RESPONSE"
        | "UPSTREAM_ERROR"
        | "UNKNOWN_ERROR";

    public readonly status?: number;

    constructor(
        code:
            | "AUTH_ERROR"
            | "MODEL_ERROR"
            | "TIMEOUT"
            | "NETWORK_ERROR"
            | "EMPTY_RESPONSE"
            | "UPSTREAM_ERROR"
            | "UNKNOWN_ERROR",
        message: string,
        status?: number
    ) {
        super(message);
        this.name = "ZhipuCallError";
        this.code = code;
        this.status = status;
    }
}

const normalizeTextContent = (value: unknown): string => {
    if (typeof value === "string") {
        return value.trim();
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                if (typeof item === "object" && item !== null) {
                    const typed = item as { type?: string; text?: string; content?: string };
                    if (typed.type === "text" && typeof typed.text === "string") {
                        return typed.text;
                    }
                    if (typeof typed.content === "string") {
                        return typed.content;
                    }
                }

                return "";
            })
            .filter((item) => item.length > 0)
            .join("\n")
            .trim();
    }

    if (typeof value === "object" && value !== null) {
        const typed = value as { text?: string; content?: string };
        if (typeof typed.text === "string") {
            return typed.text.trim();
        }
        if (typeof typed.content === "string") {
            return typed.content.trim();
        }
    }

    return "";
};

const normalizeReasoningContent = (value: unknown): string => {
    if (typeof value === "string") {
        return value.trim();
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                if (typeof item === "object" && item !== null) {
                    const typed = item as { type?: string; reasoning?: string; content?: string; text?: string };
                    if (typed.type === "thinking" && typeof typed.reasoning === "string") {
                        return typed.reasoning;
                    }
                    if (typed.type === "thinking" && typeof typed.content === "string") {
                        return typed.content;
                    }
                    if (typed.type === "thinking" && typeof typed.text === "string") {
                        return typed.text;
                    }
                }

                return "";
            })
            .filter((item) => item.length > 0)
            .join("\n")
            .trim();
    }

    if (typeof value === "object" && value !== null) {
        const typed = value as { reasoning?: string; content?: string; text?: string };
        return (typed.reasoning ?? typed.content ?? typed.text ?? "").trim();
    }

    return "";
};

const getRequestTimeoutMs = (payload: ChatPayload): number => {
    const isGlm5Family = payload.model.startsWith("glm-5");
    if (isGlm5Family && payload.enableThinking) {
        return 120000;
    }

    if (isGlm5Family) {
        return 90000;
    }

    if (payload.enableThinking) {
        return 90000;
    }

    return 60000;
};

export const callZhipu = async (payload: ChatPayload): Promise<ChatResult> => {
    const content: string | MultiModalItem[] = payload.multimodal && payload.multimodal.length > 0
        ? [...payload.multimodal, { type: "text" as const, text: payload.prompt }]
        : payload.prompt;

    const messages: Array<{
        role: "system" | "user" | "assistant";
        content: string | MultiModalItem[];
    }> = [];

    if (payload.systemPrompt) {
        messages.push({ role: "system", content: payload.systemPrompt });
    }

    for (const item of payload.historyMessages ?? []) {
        messages.push({ role: item.role, content: item.content });
    }

    messages.push({ role: "user", content });

    try {
        const response = await axios.post(
            ZHIPU_ENDPOINT,
            {
                model: payload.model,
                messages,
                thinking: payload.enableThinking ? { type: "enabled" } : undefined,
                response_format: payload.responseFormat === "json_object" ? { type: "json_object" } : undefined,
                max_tokens: 2048,
                temperature: 0.7
            },
            {
                headers: {
                    Authorization: `Bearer ${payload.apiKey}`,
                    "Content-Type": "application/json"
                },
                timeout: getRequestTimeoutMs(payload)
            }
        );

        const message = response.data?.choices?.[0]?.message;
        const content = normalizeTextContent(message?.content);
        const reasoning = normalizeReasoningContent(
            message?.reasoning_content ?? message?.reasoning ?? message?.thinking
        );

        if (!content && !reasoning) {
            throw new ZhipuCallError("EMPTY_RESPONSE", "模型未返回有效内容");
        }

        if (!content && reasoning) {
            return {
                content: "模型正在思考，暂未返回最终结论。你可以继续追问，或关闭思考模式后重试。",
                reasoning
            };
        }

        return {
            content,
            reasoning: reasoning || undefined
        };
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const detail =
                (error.response?.data as { error?: { message?: string }; message?: string } | undefined)?.error?.message ||
                (error.response?.data as { error?: { message?: string }; message?: string } | undefined)?.message ||
                error.message;

            if (status === 401 || status === 403) {
                throw new ZhipuCallError("AUTH_ERROR", `鉴权失败: ${detail}`, status);
            }

            if (status === 400 || status === 404) {
                throw new ZhipuCallError("MODEL_ERROR", `模型或参数不可用: ${detail}`, status);
            }

            if (status === 408 || error.code === "ECONNABORTED") {
                throw new ZhipuCallError("TIMEOUT", "调用超时，请稍后重试", status);
            }

            if (status) {
                throw new ZhipuCallError("UPSTREAM_ERROR", `上游服务异常: ${detail}`, status);
            }

            throw new ZhipuCallError("NETWORK_ERROR", `网络异常: ${detail}`);
        }

        if (error instanceof ZhipuCallError) {
            throw error;
        }

        const message = error instanceof Error ? error.message : "未知错误";
        throw new ZhipuCallError("UNKNOWN_ERROR", `调用失败: ${message}`);
    }
};
