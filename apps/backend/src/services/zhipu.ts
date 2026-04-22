import axios from "axios";
import type { Readable } from "node:stream";

const ZHIPU_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
export const REASONING_ONLY_HINT = "模型仅返回思考内容，系统未拿到最终结论。你可以继续追问，或稍后重试。";

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
    allowThinkingRetry?: boolean;
};

export type ChatResult = {
    content: string;
    reasoning?: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        cachedTokens?: number;
    };
    finishReason?: string | null;
    retryUsed?: boolean;
};

export type ZhipuStreamHandlers = {
    onTextDelta?: (delta: string) => void;
    onReasoningDelta?: (delta: string) => void;
    onUsage?: (usage: NonNullable<ChatResult["usage"]>) => void;
    onFinish?: (finishReason: string | null) => void;
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

const normalizeTextChunk = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
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
            .join("");
    }

    if (typeof value === "object" && value !== null) {
        const typed = value as { text?: string; content?: string };
        return typed.text ?? typed.content ?? "";
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

const buildMessages = (payload: ChatPayload): Array<{
    role: "system" | "user" | "assistant";
    content: string | MultiModalItem[];
}> => {
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
    return messages;
};

const toRequestBody = (payload: ChatPayload, stream: boolean) => {
    return {
        model: payload.model,
        messages: buildMessages(payload),
        thinking: payload.enableThinking ? { type: "enabled" } : undefined,
        response_format: payload.responseFormat === "json_object" ? { type: "json_object" } : undefined,
        max_tokens: 2048,
        temperature: 0.7,
        stream
    };
};

const mapAxiosError = (error: unknown): ZhipuCallError => {
    if (!axios.isAxiosError(error)) {
        const message = error instanceof Error ? error.message : "未知错误";
        return new ZhipuCallError("UNKNOWN_ERROR", `调用失败: ${message}`);
    }

    const status = error.response?.status;
    const detail =
        (error.response?.data as { error?: { message?: string }; message?: string } | undefined)?.error?.message ||
        (error.response?.data as { error?: { message?: string }; message?: string } | undefined)?.message ||
        error.message;

    if (status === 401 || status === 403) {
        return new ZhipuCallError("AUTH_ERROR", `鉴权失败: ${detail}`, status);
    }

    if (status === 400 || status === 404) {
        return new ZhipuCallError("MODEL_ERROR", `模型或参数不可用: ${detail}`, status);
    }

    if (status === 408 || error.code === "ECONNABORTED") {
        return new ZhipuCallError("TIMEOUT", "调用超时，请稍后重试", status);
    }

    if (status) {
        return new ZhipuCallError("UPSTREAM_ERROR", `上游服务异常: ${detail}`, status);
    }

    return new ZhipuCallError("NETWORK_ERROR", `网络异常: ${detail}`);
};

const mergeReasoningWithRetry = (firstReasoning: string, retryReasoning?: string): string => {
    return [
        firstReasoning,
        "",
        "系统提示：检测到仅有思考内容，已自动关闭思考模式重试一次。",
        retryReasoning ?? ""
    ]
        .filter((item) => item.trim().length > 0)
        .join("\n");
};

const normalizeUsage = (usage: unknown): ChatResult["usage"] | undefined => {
    if (!usage || typeof usage !== "object") {
        return undefined;
    }

    const typed = usage as {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
    };

    return {
        promptTokens: typed.prompt_tokens,
        completionTokens: typed.completion_tokens,
        totalTokens: typed.total_tokens,
        cachedTokens: typed.prompt_tokens_details?.cached_tokens
    };
};

export const callZhipu = async (payload: ChatPayload): Promise<ChatResult> => {
    try {
        const response = await axios.post(
            ZHIPU_ENDPOINT,
            toRequestBody(payload, false),
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
            if (payload.enableThinking && payload.allowThinkingRetry !== false) {
                try {
                    const retryResult = await callZhipu({
                        ...payload,
                        enableThinking: false,
                        allowThinkingRetry: false
                    });

                    return {
                        content: retryResult.content,
                        reasoning: mergeReasoningWithRetry(reasoning, retryResult.reasoning),
                        usage: retryResult.usage,
                        finishReason: retryResult.finishReason,
                        retryUsed: true
                    };
                } catch {
                    // 自动重试失败时继续走兜底提示
                }
            }

            return {
                content: REASONING_ONLY_HINT,
                reasoning,
                usage: normalizeUsage(response.data?.usage),
                finishReason: response.data?.choices?.[0]?.finish_reason ?? null
            };
        }

        return {
            content,
            reasoning: reasoning || undefined,
            usage: normalizeUsage(response.data?.usage),
            finishReason: response.data?.choices?.[0]?.finish_reason ?? null
        };
    } catch (error) {
        if (error instanceof ZhipuCallError) {
            throw error;
        }

        throw mapAxiosError(error);
    }
};

export const streamZhipu = async (payload: ChatPayload, handlers: ZhipuStreamHandlers = {}): Promise<ChatResult> => {
    try {
        const response = await axios.post(ZHIPU_ENDPOINT, toRequestBody(payload, true), {
            headers: {
                Authorization: `Bearer ${payload.apiKey}`,
                "Content-Type": "application/json"
            },
            responseType: "stream",
            timeout: getRequestTimeoutMs(payload)
        });

        const stream = response.data as Readable;
        let content = "";
        let reasoning = "";
        let buffer = "";
        let usage: ChatResult["usage"];
        let finishReason: string | null = null;

        const parseBuffer = (): void => {
            const matcher = /\r?\n\r?\n/;
            let separatorMatch = buffer.match(matcher);
            while (separatorMatch && separatorMatch.index !== undefined) {
                const separatorIndex = separatorMatch.index;
                const block = buffer.slice(0, separatorIndex);
                buffer = buffer.slice(separatorIndex + separatorMatch[0].length);

                const dataLines = block
                    .split(/\r?\n/)
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => line.slice(5).trim())
                    .filter((line) => line.length > 0);

                if (dataLines.length > 0) {
                    const payloadLine = dataLines.join("");
                    if (payloadLine !== "[DONE]") {
                        try {
                            const parsed = JSON.parse(payloadLine) as {
                                choices?: Array<{
                                    delta?: {
                                        content?: unknown;
                                        reasoning_content?: unknown;
                                        reasoning?: unknown;
                                        thinking?: unknown;
                                    };
                                    message?: {
                                        content?: unknown;
                                        reasoning_content?: unknown;
                                        reasoning?: unknown;
                                        thinking?: unknown;
                                    };
                                    finish_reason?: string | null;
                                }>;
                                usage?: unknown;
                            };

                            const choice = parsed.choices?.[0];
                            const delta = choice?.delta ?? choice?.message;
                            if (delta) {
                                const textDelta = normalizeTextChunk(delta.content);
                                const reasoningDelta = normalizeTextChunk(delta.reasoning_content ?? delta.reasoning ?? delta.thinking);

                                if (textDelta.length > 0) {
                                    content += textDelta;
                                    handlers.onTextDelta?.(textDelta);
                                }

                                if (reasoningDelta.length > 0) {
                                    reasoning += reasoningDelta;
                                    handlers.onReasoningDelta?.(reasoningDelta);
                                }
                            }

                            if (choice?.finish_reason !== undefined) {
                                finishReason = choice.finish_reason ?? null;
                                handlers.onFinish?.(finishReason);
                            }

                            const normalizedUsage = normalizeUsage(parsed.usage);
                            if (normalizedUsage) {
                                usage = normalizedUsage;
                                handlers.onUsage?.(normalizedUsage);
                            }
                        } catch {
                            // 忽略非JSON事件块
                        }
                    }
                }

                separatorMatch = buffer.match(matcher);
            }
        };

        for await (const chunk of stream) {
            buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
            parseBuffer();
        }

        parseBuffer();

        const normalizedContent = content.trim();
        const normalizedReasoning = reasoning.trim();

        if (!normalizedContent && !normalizedReasoning) {
            throw new ZhipuCallError("EMPTY_RESPONSE", "模型未返回有效内容");
        }

        if (!normalizedContent && normalizedReasoning) {
            if (payload.enableThinking && payload.allowThinkingRetry !== false) {
                try {
                    const retryResult = await callZhipu({
                        ...payload,
                        enableThinking: false,
                        allowThinkingRetry: false
                    });
                    handlers.onTextDelta?.(retryResult.content);

                    return {
                        content: retryResult.content,
                        reasoning: mergeReasoningWithRetry(normalizedReasoning, retryResult.reasoning),
                        usage: retryResult.usage,
                        finishReason: retryResult.finishReason,
                        retryUsed: true
                    };
                } catch {
                    // 降级重试失败时继续返回兜底文案
                }
            }

            handlers.onTextDelta?.(REASONING_ONLY_HINT);
            return {
                content: REASONING_ONLY_HINT,
                reasoning: normalizedReasoning,
                usage,
                finishReason
            };
        }

        return {
            content: normalizedContent,
            reasoning: normalizedReasoning || undefined,
            usage,
            finishReason
        };
    } catch (error) {
        if (error instanceof ZhipuCallError) {
            throw error;
        }

        throw mapAxiosError(error);
    }
};
