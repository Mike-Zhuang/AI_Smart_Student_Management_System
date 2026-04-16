import { Router } from "express";
import { z } from "zod";
import { PROMPT_TEMPLATES, fillTemplate, getTemplateById } from "../config/promptTemplates.js";
import { SUPPORTED_MODELS } from "../constants.js";
import { requireAuth } from "../middleware/auth.js";
import { callZhipu } from "../services/zhipu.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";

const schema = z.object({
  apiKey: z.string().min(10),
  model: z.string().min(3),
  prompt: z.string().min(1),
  multimodal: z
    .array(
      z.object({
        type: z.enum(["text", "image_url", "video_url", "file_url"]),
        text: z.string().optional(),
        image_url: z.object({ url: z.string().url() }).optional(),
        video_url: z.object({ url: z.string().url() }).optional(),
        file_url: z.object({ url: z.string().url() }).optional()
      })
    )
    .optional(),
  enableThinking: z.boolean().optional()
});

const templateChatSchema = z.object({
  apiKey: z.string().min(10),
  model: z.string().min(3),
  templateId: z.string().min(3),
  variables: z.record(z.string()).optional(),
  enableThinking: z.boolean().optional()
});

export const aiRouter = Router();

aiRouter.get("/models", requireAuth, (_req, res) => {
  res.json({ success: true, message: "模型列表", data: SUPPORTED_MODELS });
});

aiRouter.get("/prompt-templates", requireAuth, (req, res) => {
  const scenario = typeof req.query.scenario === "string" ? req.query.scenario : null;
  const list = scenario
    ? PROMPT_TEMPLATES.filter((item) => item.scenario === scenario)
    : PROMPT_TEMPLATES;

  res.json({ success: true, message: "模板列表", data: list });
});

aiRouter.post("/chat", requireAuth, async (req, res) => {
  const authedReq = req as AuthedRequest;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "请求参数不合法" });
    return;
  }

  try {
    const data = parsed.data;
    const startedAt = Date.now();
    const model = SUPPORTED_MODELS.find((item) => item.id === data.model);
    if (!model) {
      res.status(400).json({ success: false, message: "不支持的模型" });
      return;
    }

    if (!model.multimodal && data.multimodal && data.multimodal.length > 0) {
      res.status(400).json({ success: false, message: "当前模型不支持多模态输入" });
      return;
    }

    const answer = await callZhipu(data);
    if (authedReq.user) {
      logAudit({
        userId: authedReq.user.id,
        actionModule: "ai",
        actionType: "chat",
        objectType: "model_call",
        detail: {
          model: data.model,
          promptLength: data.prompt.length,
          elapsedMs: Date.now() - startedAt
        },
        ipAddress: extractIp(req)
      });
    }

    res.json({ success: true, message: "调用成功", data: { answer } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    res.status(502).json({ success: false, message: `模型调用失败: ${reason}` });
  }
});

aiRouter.post("/chat-with-template", requireAuth, async (req, res) => {
  const authedReq = req as AuthedRequest;
  const parsed = templateChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "请求参数不合法" });
    return;
  }

  const input = parsed.data;
  const template = getTemplateById(input.templateId);
  if (!template) {
    res.status(404).json({ success: false, message: "模板不存在" });
    return;
  }

  const model = SUPPORTED_MODELS.find((item) => item.id === input.model);
  if (!model) {
    res.status(400).json({ success: false, message: "不支持的模型" });
    return;
  }

  const prompt = `${fillTemplate(template.template, input.variables ?? {})}\n\n输出规范:\n${template.outputSpec}`;

  try {
    const startedAt = Date.now();
    const answer = await callZhipu({
      apiKey: input.apiKey,
      model: input.model,
      prompt,
      enableThinking: input.enableThinking
    });

    if (authedReq.user) {
      logAudit({
        userId: authedReq.user.id,
        actionModule: "ai",
        actionType: "chat_with_template",
        objectType: "prompt_template",
        detail: {
          templateId: input.templateId,
          model: input.model,
          elapsedMs: Date.now() - startedAt
        },
        ipAddress: extractIp(req)
      });
    }

    res.json({
      success: true,
      message: "调用成功",
      data: {
        templateId: template.id,
        templateName: template.name,
        answer
      }
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    res.status(502).json({ success: false, message: `模型调用失败: ${reason}` });
  }
});
