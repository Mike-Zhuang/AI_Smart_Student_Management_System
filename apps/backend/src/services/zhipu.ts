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
};

export const callZhipu = async (payload: ChatPayload): Promise<string> => {
    const content = payload.multimodal && payload.multimodal.length > 0
        ? [...payload.multimodal, { type: "text", text: payload.prompt }]
        : payload.prompt;

    const messages = payload.systemPrompt
        ? [{ role: "system", content: payload.systemPrompt }, { role: "user", content }]
        : [{ role: "user", content }];

    const response = await axios.post(
        ZHIPU_ENDPOINT,
        {
            model: payload.model,
            messages,
            thinking: payload.enableThinking ? { type: "enabled" } : undefined,
            max_tokens: 2048,
            temperature: 0.7
        },
        {
            headers: {
                Authorization: `Bearer ${payload.apiKey}`,
                "Content-Type": "application/json"
            },
            timeout: 60000
        }
    );

    const answer = response.data?.choices?.[0]?.message?.content;
    if (!answer) {
        return "模型未返回内容，请稍后重试。";
    }

    return typeof answer === "string" ? answer : JSON.stringify(answer);
};
