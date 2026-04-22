export type ModelPricingTier = "free" | "paid";

export type SupportedModel = {
    id: string;
    name: string;
    description: string;
    supportsStreaming: boolean;
    supportsThinking: boolean;
    supportsJsonMode: boolean;
    supportsVision: boolean;
    inputTypes: Array<"text" | "image">;
    pricingTier: ModelPricingTier;
    isDefault: boolean;
};

export type StreamCompletePayload = {
    answer?: string;
    draft?: string;
    reasoning?: string;
    conversationId?: number;
    model?: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        cachedTokens?: number;
    };
    finishReason?: string | null;
    result?: unknown;
};

export const getModelCapabilityTags = (model: SupportedModel): string[] => {
    return [
        model.pricingTier === "paid" ? "收费" : "免费",
        model.supportsVision ? "视觉" : "文本",
        model.supportsStreaming ? "流式" : "非流式",
        model.supportsJsonMode ? "结构化" : "自然文本",
        model.supportsThinking ? "支持思考" : "直出"
    ];
};
