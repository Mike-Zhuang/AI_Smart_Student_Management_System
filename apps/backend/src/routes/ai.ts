import { Router } from "express";
import { z } from "zod";
import { SUPPORTED_MODELS } from "../constants.js";
import { requireAuth } from "../middleware/auth.js";
import { callZhipu } from "../services/zhipu.js";

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

export const aiRouter = Router();

aiRouter.get("/models", requireAuth, (_req, res) => {
  res.json({ success: true, message: "模型列表", data: SUPPORTED_MODELS });
});

aiRouter.post("/chat", requireAuth, async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "请求参数不合法" });
    return;
  }

  try {
    const data = parsed.data;
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
    res.json({ success: true, message: "调用成功", data: { answer } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    res.status(502).json({ success: false, message: `模型调用失败: ${reason}` });
  }
});
