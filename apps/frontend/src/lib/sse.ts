import { fetchWithAuth } from "./api";
import type { StreamCompletePayload } from "./ai";

type StreamEventHandlers = {
    onConversation?: (payload: Record<string, unknown>) => void;
    onTextDelta?: (delta: string) => void;
    onReasoningDelta?: (delta: string) => void;
    onUsage?: (payload: Record<string, unknown>) => void;
};

const parseBlock = (block: string): { event: string; data: string } | null => {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
    const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) {
        return null;
    }

    return {
        event,
        data: dataLines.join("\n")
    };
};

export const consumeSseStream = async (
    path: string,
    options: {
        method?: "POST";
        body?: BodyInit;
        headers?: Record<string, string>;
        signal?: AbortSignal;
    },
    handlers: StreamEventHandlers = {}
): Promise<StreamCompletePayload> => {
    const response = await fetchWithAuth(path, {
        method: options.method ?? "POST",
        headers: options.headers,
        body: options.body,
        signal: options.signal
    });

    if (!response.ok || !response.body) {
        const raw = await response.text();
        try {
            const parsed = JSON.parse(raw) as { message?: string };
            throw new Error(parsed.message ?? "流式调用失败");
        } catch {
            throw new Error(raw || "流式调用失败");
        }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completePayload: StreamCompletePayload | null = null;
    let lastMeaningfulPayload: StreamCompletePayload | null = null;

    const processBlock = (block: string): void => {
        const parsedBlock = parseBlock(block);
        if (!parsedBlock) {
            return;
        }

        if (parsedBlock.data === "[DONE]") {
            return;
        }

        const parsed = JSON.parse(parsedBlock.data) as Record<string, unknown>;
        if (parsedBlock.event === "conversation") {
            handlers.onConversation?.(parsed);
            return;
        }

        if (parsedBlock.event === "delta" && typeof parsed.delta === "string") {
            handlers.onTextDelta?.(parsed.delta);
            return;
        }

        if (parsedBlock.event === "reasoning-delta" && typeof parsed.delta === "string") {
            handlers.onReasoningDelta?.(parsed.delta);
            return;
        }

        if (parsedBlock.event === "usage") {
            handlers.onUsage?.(parsed);
            return;
        }

        if (parsedBlock.event === "error") {
            throw new Error(typeof parsed.message === "string" ? parsed.message : "流式调用失败");
        }

        if (parsedBlock.event === "complete") {
            completePayload = parsed as StreamCompletePayload;
            lastMeaningfulPayload = completePayload;
            return;
        }

        if ("result" in parsed || "answer" in parsed || "draft" in parsed) {
            lastMeaningfulPayload = parsed as StreamCompletePayload;
        }
    };

    const flushBuffer = (): void => {
        const matcher = /\r?\n\r?\n/;
        let matched = buffer.match(matcher);
        while (matched && matched.index !== undefined) {
            const block = buffer.slice(0, matched.index);
            buffer = buffer.slice(matched.index + matched[0].length);
            processBlock(block);
            matched = buffer.match(matcher);
        }
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        flushBuffer();
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
        processBlock(buffer.trim());
    }

    if (completePayload) {
        return completePayload;
    }

    if (lastMeaningfulPayload) {
        return lastMeaningfulPayload;
    }

    throw new Error("流式会话异常结束，未收到完成事件");
};
