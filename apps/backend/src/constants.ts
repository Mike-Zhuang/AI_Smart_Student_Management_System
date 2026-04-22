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

export type SupportedModel = {
  id: string;
  name: string;
  description: string;
  multimodal: boolean;
  thinking: boolean;
  supportsJsonMode: boolean;
  pricingTier: ModelPricingTier;
  isDefault: boolean;
};

export const SUPPORTED_MODELS = [
  {
    id: "glm-4.7-flash",
    name: "GLM-4.7-Flash",
    description: "免费文本模型，支持思考与结构化输出，适合作为默认模型。",
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    pricingTier: "free",
    isDefault: true
  },
  {
    id: "glm-5",
    name: "GLM-5",
    description: "收费基座模型，长上下文与复杂工程任务能力更强，支持思考与结构化输出。",
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-5.1",
    name: "GLM-5.1",
    description: "收费文本旗舰模型，适合复杂分析和高质量生成。",
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-5-turbo",
    name: "GLM-5-Turbo",
    description: "收费文本模型，速度与效果均衡，支持结构化输出。",
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4.5",
    name: "GLM-4.5",
    description: "收费高性能文本模型，适合复杂推理与稳定结构化生成。",
    multimodal: false,
    thinking: true,
    supportsJsonMode: true,
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4-plus",
    name: "GLM-4-Plus",
    description: "收费高性能文本模型，适合高质量通用问答与结构化输出。",
    multimodal: false,
    thinking: false,
    supportsJsonMode: true,
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4.1v-thinking-flash",
    name: "GLM-4.1V-Thinking-Flash",
    description: "免费多模态思考模型，适合图像理解与复杂推理。",
    multimodal: true,
    thinking: true,
    supportsJsonMode: false,
    pricingTier: "free",
    isDefault: false
  },
  {
    id: "glm-4.5v",
    name: "GLM-4.5V",
    description: "收费多模态模型，支持图片、视频、文件理解与深度思考。",
    multimodal: true,
    thinking: true,
    supportsJsonMode: false,
    pricingTier: "paid",
    isDefault: false
  },
  {
    id: "glm-4.6v-flash",
    name: "GLM-4.6V-Flash",
    description: "免费多模态模型，响应较快，适合图文理解。",
    multimodal: true,
    thinking: false,
    supportsJsonMode: false,
    pricingTier: "free",
    isDefault: false
  },
  {
    id: "glm-4-flash-250414",
    name: "GLM-4-Flash-250414",
    description: "免费文本模型，适合轻量问答和常规生成任务。",
    multimodal: false,
    thinking: false,
    supportsJsonMode: true,
    pricingTier: "free",
    isDefault: false
  },
  {
    id: "glm-4v-flash",
    name: "GLM-4V-Flash",
    description: "免费多模态模型，适合图文输入与快速理解。",
    multimodal: true,
    thinking: false,
    supportsJsonMode: false,
    pricingTier: "free",
    isDefault: false
  }
] as const satisfies readonly SupportedModel[];

export const DEFAULT_MODEL_ID = SUPPORTED_MODELS.find((item) => item.isDefault)?.id ?? "glm-4.7-flash";

export const getSupportedModelById = (id: string): SupportedModel | undefined => {
  return SUPPORTED_MODELS.find((item) => item.id === id);
};
