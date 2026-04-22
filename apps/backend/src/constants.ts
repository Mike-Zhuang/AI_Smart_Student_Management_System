export const ROLES = {
  ADMIN: "admin",
  TEACHER: "teacher",
  HEAD_TEACHER: "head_teacher",
  PARENT: "parent",
  STUDENT: "student"
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
export type AiScenario = "career" | "growth" | "home-school" | "general";

export type ModelPricingTier = "free" | "paid";
export type ModelInputType = "text" | "image";

export type SupportedModel = {
  id: string;
  name: string;
  description: string;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  multimodal: boolean;
  thinking: boolean;
  supportsJsonMode: boolean;
  supportsVision: boolean;
  inputTypes: ModelInputType[];
  pricingTier: ModelPricingTier;
  isDefault: boolean;
};

export const SUPPORTED_MODELS = [
  {
    id: "glm-4.7-flash",
    name: "GLM-4.7-Flash",
    description: "免费文本模型，支持思考与结构化输出，适合作为默认模型。",
    supportsStreaming: true,
    supportsThinking: true,
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    supportsVision: false,
    inputTypes: ["text"],
    pricingTier: "free",
    isDefault: true
  },
  {
    id: "glm-4-flash-250414",
    name: "GLM-4-Flash-250414",
    description: "免费文本模型，支持流式与结构化输出，适合轻量问答和常规生成任务。",
    supportsStreaming: true,
    supportsThinking: false,
    multimodal: false,
    thinking: false,
    supportsJsonMode: true,
    supportsVision: false,
    inputTypes: ["text"],
    pricingTier: "free",
    isDefault: false
  },
  {
    id: "glm-5",
    name: "GLM-5",
    description: "收费基座模型，长上下文与复杂工程任务能力更强，支持思考与结构化输出。",
    supportsStreaming: true,
    supportsThinking: true,
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    supportsVision: false,
    inputTypes: ["text"],
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-5.1",
    name: "GLM-5.1",
    description: "收费文本旗舰模型，适合复杂分析和高质量生成。",
    supportsStreaming: true,
    supportsThinking: true,
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    supportsVision: false,
    inputTypes: ["text"],
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-5-turbo",
    name: "GLM-5-Turbo",
    description: "收费文本模型，速度与效果均衡，支持结构化输出。",
    supportsStreaming: true,
    supportsThinking: true,
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    supportsVision: false,
    inputTypes: ["text"],
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4.7",
    name: "GLM-4.7",
    description: "收费文本模型，支持流式、思考与结构化输出，适合稳定生成高质量内容。",
    supportsStreaming: true,
    supportsThinking: true,
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    supportsVision: false,
    inputTypes: ["text"],
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4.6",
    name: "GLM-4.6",
    description: "收费文本模型，支持流式、思考与结构化输出，适合复杂分析场景。",
    supportsStreaming: true,
    supportsThinking: true,
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    supportsVision: false,
    inputTypes: ["text"],
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4.5",
    name: "GLM-4.5",
    description: "收费高性能文本模型，适合复杂推理与稳定结构化生成。",
    supportsStreaming: true,
    supportsThinking: true,
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    supportsVision: false,
    inputTypes: ["text"],
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4.1v-thinking-flash",
    name: "GLM-4.1V-Thinking-Flash",
    description: "免费多模态思考模型，适合图像理解与复杂推理。",
    supportsStreaming: true,
    supportsThinking: true,
    multimodal: true,
    thinking: true,
    supportsJsonMode: false,
    supportsVision: true,
    inputTypes: ["text", "image"],
    pricingTier: "free",
    isDefault: false
  },
  {
    id: "glm-4.6v-flash",
    name: "GLM-4.6V-Flash",
    description: "免费多模态模型，支持图像输入与流式输出，适合图文快速理解。",
    supportsStreaming: true,
    supportsThinking: false,
    multimodal: true,
    thinking: false,
    supportsJsonMode: false,
    supportsVision: true,
    inputTypes: ["text", "image"],
    pricingTier: "free",
    isDefault: false
  },
  {
    id: "glm-4v-flash",
    name: "GLM-4V-Flash",
    description: "免费多模态模型，支持图像理解与流式输出。",
    supportsStreaming: true,
    supportsThinking: false,
    multimodal: true,
    thinking: false,
    supportsJsonMode: false,
    supportsVision: true,
    inputTypes: ["text", "image"],
    pricingTier: "free",
    isDefault: false
  },
  {
    id: "glm-5v-turbo",
    name: "GLM-5V-Turbo",
    description: "收费视觉模型，支持图像理解与流式输出，适合图文问答。",
    supportsStreaming: true,
    supportsThinking: false,
    multimodal: true,
    thinking: false,
    supportsJsonMode: false,
    supportsVision: true,
    inputTypes: ["text", "image"],
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4.6v",
    name: "GLM-4.6V",
    description: "收费视觉模型，支持图像理解与流式输出。",
    supportsStreaming: true,
    supportsThinking: false,
    multimodal: true,
    thinking: false,
    supportsJsonMode: false,
    supportsVision: true,
    inputTypes: ["text", "image"],
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4.1v-thinking",
    name: "GLM-4.1V-Thinking",
    description: "收费视觉思考模型，支持图像理解、流式输出与思考过程。",
    supportsStreaming: true,
    supportsThinking: true,
    multimodal: true,
    thinking: true,
    supportsJsonMode: false,
    supportsVision: true,
    inputTypes: ["text", "image"],
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-ocr",
    name: "GLM-OCR",
    description: "收费视觉 OCR 模型，适合图片文字识别与结构化提取，不支持流式输出。",
    supportsStreaming: false,
    supportsThinking: false,
    multimodal: true,
    thinking: false,
    supportsJsonMode: true,
    supportsVision: true,
    inputTypes: ["text", "image"],
    pricingTier: "paid",
    isDefault: false
  }
] as const satisfies readonly SupportedModel[];

export const DEFAULT_MODEL_ID = SUPPORTED_MODELS.find((item) => item.isDefault)?.id ?? "glm-4.7-flash";

export const getSupportedModelById = (id: string): SupportedModel | undefined => {
  return SUPPORTED_MODELS.find((item) => item.id === id);
};
