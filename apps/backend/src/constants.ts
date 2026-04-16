export const ROLES = {
  ADMIN: "admin",
  TEACHER: "teacher",
  HEAD_TEACHER: "head_teacher",
  PARENT: "parent",
  STUDENT: "student"
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const SUPPORTED_MODELS = [
  {
    id: "glm-4.7-flash",
    name: "GLM-4.7-Flash",
    description: "支持思考的文本模型，适合规划与分析。",
    multimodal: false,
    thinking: true
  },
  {
    id: "glm-4.1v-thinking-flash",
    name: "GLM-4.1V-Thinking-Flash",
    description: "旧版多模态思考模型，适合复杂推理和图像理解。",
    multimodal: true,
    thinking: true
  },
  {
    id: "glm-4.6v-flash",
    name: "GLM-4.6V-Flash",
    description: "新版多模态模型，不走思考链，响应更快。",
    multimodal: true,
    thinking: false
  }
] as const;
