import dayjs from "dayjs";
import { Router, type Response } from "express";
import { z } from "zod";
import { PROMPT_TEMPLATES, fillTemplate, getTemplateById } from "../config/promptTemplates.js";
import { DEFAULT_MODEL_ID, getSupportedModelById, SUPPORTED_MODELS } from "../constants.js";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { callZhipu, streamZhipu, ZhipuCallError } from "../services/zhipu.js";
import type { AuthedRequest } from "../types.js";
import { extractIp, logAudit } from "../utils/audit.js";

const chatSchema = z.object({
    apiKey: z.string().min(10),
    model: z.string().min(3).optional(),
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
    enableThinking: z.boolean().optional(),
    responseFormat: z.enum(["text", "json_object"]).optional(),
    conversationId: z.number().int().positive().optional(),
    scenario: z.enum(["career", "growth", "home-school", "general"]).optional()
});

const templateChatSchema = z.object({
    apiKey: z.string().min(10),
    model: z.string().min(3).optional(),
    templateId: z.string().min(3),
    variables: z.record(z.string()).default({}),
    enableThinking: z.boolean().optional(),
    conversationId: z.number().int().positive().optional()
});

const createConversationSchema = z.object({
    title: z.string().min(1).max(60).optional(),
    scenario: z.enum(["career", "growth", "home-school", "general"]).optional(),
    model: z.string().min(3).optional()
});

export const aiRouter = Router();

const pruneExpiredConversations = (): void => {
    const expireBefore = dayjs().subtract(7, "day").toISOString();
    db.prepare(
        `DELETE FROM chat_messages
         WHERE session_id IN (
            SELECT id FROM chat_sessions WHERE updated_at < ?
         )`
    ).run(expireBefore);
    db.prepare(`DELETE FROM chat_sessions WHERE updated_at < ?`).run(expireBefore);
};

const getConversationById = (conversationId: number, userId: number): { id: number } | undefined => {
    return db
        .prepare(`SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?`)
        .get(conversationId, userId) as { id: number } | undefined;
};

const createConversation = (userId: number, model: string, scenario: string | null, title: string | null): number => {
    const now = dayjs().toISOString();
    const result = db
        .prepare(
            `INSERT INTO chat_sessions (user_id, title, scenario, model, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(userId, title, scenario, model, now, now);

    return Number(result.lastInsertRowid);
};

const getHistoryMessages = (conversationId: number): Array<{ role: "user" | "assistant"; content: string }> => {
    const rows = db
        .prepare(
            `SELECT role, content
             FROM chat_messages
             WHERE session_id = ?
             ORDER BY id DESC
             LIMIT 12`
        )
        .all(conversationId) as Array<{ role: string; content: string }>;

    return rows
        .reverse()
        .filter((item) => item.role === "user" || item.role === "assistant")
        .map((item) => ({ role: item.role as "user" | "assistant", content: item.content }));
};

const appendMessage = (
    conversationId: number,
    role: "user" | "assistant",
    content: string,
    reasoning?: string
): void => {
    const now = dayjs().toISOString();
    db.prepare(
        `INSERT INTO chat_messages (session_id, role, content, reasoning_content, created_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(conversationId, role, content, reasoning ?? null, now);

    db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`).run(now, conversationId);
};

const summarizeTemplateVariables = (variables: Record<string, string>): string => {
    const entries = Object.entries(variables);
    if (entries.length === 0) {
        return "无";
    }

    const summary = entries
        .map(([key, value]) => {
            const normalized = value.replace(/\s+/g, " ").trim();
            const shortValue = normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
            return `${key}=${shortValue || "(空)"}`;
        })
        .join("; ");

    return summary.length > 240 ? `${summary.slice(0, 240)}...` : summary;
};

const toPublicErrorMessage = (error: unknown): string => {
    if (error instanceof ZhipuCallError) {
        return error.message;
    }
    return error instanceof Error ? error.message : "未知错误";
};

const initSse = (res: Response): void => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }
};

const sendSse = (
    res: Response,
    event: string,
    payload: unknown
): void => {
    if (res.writableEnded) {
        return;
    }

    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

aiRouter.get("/models", requireAuth, (_req, res) => {
    res.json({ success: true, message: "模型列表", data: SUPPORTED_MODELS });
});

aiRouter.get("/prompt-templates", requireAuth, (req, res) => {
    const scenario = typeof req.query.scenario === "string" ? req.query.scenario : null;
    const list = scenario
        ? PROMPT_TEMPLATES.filter((item) => item.scenario === scenario)
        : PROMPT_TEMPLATES;

    const safeList = list.map((item) => ({
        id: item.id,
        name: item.name,
        scenario: item.scenario,
        description: item.description,
        userGuide: item.userGuide,
        recommendedModels: item.recommendedModels,
        outputSpec: item.outputSpec,
        outputFormat: item.outputFormat,
        requiresJsonMode: item.outputFormat === "json_object",
        variableMeta: item.variableMeta
    }));

    res.json({ success: true, message: "模板列表", data: safeList });
});

aiRouter.get("/conversations", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    pruneExpiredConversations();

    const scenario = typeof req.query.scenario === "string" ? req.query.scenario : null;
    const rows = scenario
        ? db
            .prepare(
                `SELECT id, title, scenario, model, created_at as createdAt, updated_at as updatedAt
                 FROM chat_sessions
                 WHERE user_id = ? AND scenario = ?
                 ORDER BY updated_at DESC`
            )
            .all(req.user.id, scenario)
        : db
            .prepare(
                `SELECT id, title, scenario, model, created_at as createdAt, updated_at as updatedAt
                 FROM chat_sessions
                 WHERE user_id = ?
                 ORDER BY updated_at DESC`
            )
            .all(req.user.id);

    res.json({ success: true, message: "查询成功", data: rows });
});

aiRouter.get("/conversations/:id/messages", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    pruneExpiredConversations();

    const conversationId = Number(req.params.id);
    if (Number.isNaN(conversationId)) {
        res.status(400).json({ success: false, message: "会话ID不合法" });
        return;
    }

    const conversation = getConversationById(conversationId, req.user.id);
    if (!conversation) {
        res.status(404).json({ success: false, message: "会话不存在" });
        return;
    }

    const rows = db
        .prepare(
            `SELECT id, role, content, reasoning_content as reasoning, created_at as createdAt
             FROM chat_messages
             WHERE session_id = ?
             ORDER BY id ASC`
        )
        .all(conversationId);

    res.json({ success: true, message: "查询成功", data: rows });
});

aiRouter.post("/conversations", requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "未登录" });
        return;
    }

    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "参数不合法" });
        return;
    }

    const modelId = parsed.data.model ?? DEFAULT_MODEL_ID;
    const model = getSupportedModelById(modelId);
    if (!model) {
        res.status(400).json({ success: false, message: "不支持的模型" });
        return;
    }

    const sessionId = createConversation(req.user.id, model.id, parsed.data.scenario ?? "general", parsed.data.title ?? "新会话");

    res.json({ success: true, message: "创建成功", data: { conversationId: sessionId } });
});

aiRouter.post("/chat", requireAuth, async (req, res) => {
    const authedReq = req as AuthedRequest;
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success || !authedReq.user) {
        res.status(400).json({ success: false, message: "请求参数不合法" });
        return;
    }

    try {
        pruneExpiredConversations();

        const data = parsed.data;
        const startedAt = Date.now();
        const model = getSupportedModelById(data.model ?? DEFAULT_MODEL_ID);
        if (!model) {
            res.status(400).json({ success: false, message: "不支持的模型" });
            return;
        }

        if (!model.multimodal && data.multimodal && data.multimodal.length > 0) {
            res.status(400).json({ success: false, message: "当前模型不支持多模态输入" });
            return;
        }

        const responseFormat = data.responseFormat ?? "text";
        if (responseFormat === "json_object" && !model.supportsJsonMode) {
            res.status(400).json({ success: false, message: `模型 ${model.name} 不支持结构化输出模式` });
            return;
        }

        let conversationId = data.conversationId;
        if (conversationId) {
            const conversation = getConversationById(conversationId, authedReq.user.id);
            if (!conversation) {
                res.status(404).json({ success: false, message: "会话不存在" });
                return;
            }
        } else {
            const title = data.prompt.length > 20 ? `${data.prompt.slice(0, 20)}...` : data.prompt;
            conversationId = createConversation(authedReq.user.id, model.id, data.scenario ?? "general", title);
        }

        const historyMessages = getHistoryMessages(conversationId);
        const result = await callZhipu({
            ...data,
            model: model.id,
            responseFormat,
            historyMessages,
            enableThinking: data.enableThinking ?? model.thinking
        });

        const userMessage = data.multimodal && data.multimodal.length > 0
            ? `[多模态输入 ${data.multimodal.length} 项]\n${data.prompt}`
            : data.prompt;

        appendMessage(conversationId, "user", userMessage);
        appendMessage(conversationId, "assistant", result.content, result.reasoning);

        if (authedReq.user) {
            logAudit({
                userId: authedReq.user.id,
                actionModule: "ai",
                actionType: "chat",
                objectType: "model_call",
                detail: {
                    model: model.id,
                    pricingTier: model.pricingTier,
                    responseFormat,
                    conversationId,
                    promptLength: data.prompt.length,
                    elapsedMs: Date.now() - startedAt
                },
                ipAddress: extractIp(req)
            });
        }

        res.json({
            success: true,
            message: "调用成功",
            data: {
                answer: result.content,
                reasoning: result.reasoning,
                conversationId,
                model: model.id
            }
        });
    } catch (error) {
        res.status(502).json({ success: false, message: `模型调用失败: ${toPublicErrorMessage(error)}` });
    }
});

aiRouter.post("/chat-stream", requireAuth, async (req, res) => {
    const authedReq = req as AuthedRequest;
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success || !authedReq.user) {
        res.status(400).json({ success: false, message: "请求参数不合法" });
        return;
    }

    pruneExpiredConversations();
    const data = parsed.data;
    const model = getSupportedModelById(data.model ?? DEFAULT_MODEL_ID);
    if (!model) {
        res.status(400).json({ success: false, message: "不支持的模型" });
        return;
    }

    if (!model.multimodal && data.multimodal && data.multimodal.length > 0) {
        res.status(400).json({ success: false, message: "当前模型不支持多模态输入" });
        return;
    }

    const responseFormat = data.responseFormat ?? "text";
    if (responseFormat === "json_object" && !model.supportsJsonMode) {
        res.status(400).json({ success: false, message: `模型 ${model.name} 不支持结构化输出模式` });
        return;
    }

    let conversationId = data.conversationId;
    if (conversationId) {
        const conversation = getConversationById(conversationId, authedReq.user.id);
        if (!conversation) {
            res.status(404).json({ success: false, message: "会话不存在" });
            return;
        }
    } else {
        const title = data.prompt.length > 20 ? `${data.prompt.slice(0, 20)}...` : data.prompt;
        conversationId = createConversation(authedReq.user.id, model.id, data.scenario ?? "general", title);
    }

    const startedAt = Date.now();
    const userMessage = data.multimodal && data.multimodal.length > 0
        ? `[多模态输入 ${data.multimodal.length} 项]\n${data.prompt}`
        : data.prompt;
    appendMessage(conversationId, "user", userMessage);

    initSse(res);
    sendSse(res, "conversation", { conversationId, model: model.id });

    let closed = false;
    req.on("close", () => {
        closed = true;
    });

    try {
        const historyMessages = getHistoryMessages(conversationId).slice(0, -1);
        const result = await streamZhipu(
            {
                ...data,
                model: model.id,
                responseFormat,
                historyMessages,
                enableThinking: data.enableThinking ?? model.thinking
            },
            {
                onTextDelta: (delta) => {
                    if (closed) {
                        return;
                    }
                    sendSse(res, "delta", { delta });
                },
                onReasoningDelta: (delta) => {
                    if (closed) {
                        return;
                    }
                    sendSse(res, "reasoning-delta", { delta });
                }
            }
        );

        appendMessage(conversationId, "assistant", result.content, result.reasoning);

        logAudit({
            userId: authedReq.user.id,
            actionModule: "ai",
            actionType: "chat_stream",
            objectType: "model_call",
            detail: {
                model: model.id,
                pricingTier: model.pricingTier,
                responseFormat,
                conversationId,
                promptLength: data.prompt.length,
                retryUsed: result.retryUsed ?? false,
                elapsedMs: Date.now() - startedAt
            },
            ipAddress: extractIp(req)
        });

        sendSse(res, "complete", {
            answer: result.content,
            reasoning: result.reasoning,
            conversationId,
            model: model.id
        });
    } catch (error) {
        sendSse(res, "error", { message: `模型调用失败: ${toPublicErrorMessage(error)}` });
    } finally {
        res.end();
    }
});

aiRouter.post("/chat-with-template", requireAuth, async (req, res) => {
    const authedReq = req as AuthedRequest;
    const parsed = templateChatSchema.safeParse(req.body);
    if (!parsed.success || !authedReq.user) {
        res.status(400).json({ success: false, message: "请求参数不合法" });
        return;
    }

    pruneExpiredConversations();

    const input = parsed.data;
    const template = getTemplateById(input.templateId);
    if (!template) {
        res.status(404).json({ success: false, message: "模板不存在" });
        return;
    }

    const model = getSupportedModelById(input.model ?? DEFAULT_MODEL_ID);
    if (!model) {
        res.status(400).json({ success: false, message: "不支持的模型" });
        return;
    }

    if (template.outputFormat === "json_object" && !model.supportsJsonMode) {
        res.status(400).json({ success: false, message: `模板需要结构化输出，模型 ${model.name} 不支持` });
        return;
    }

    const prompt = `${fillTemplate(template.template, input.variables)}\n\n输出规范:\n${template.outputSpec}`;

    const missingVariables = template.variableMeta
        .map((item) => item.key)
        .filter((key) => !input.variables[key] || input.variables[key].trim().length === 0);

    if (missingVariables.length > 0) {
        res.status(400).json({
            success: false,
            message: `模板变量缺失: ${missingVariables.join(", ")}`
        });
        return;
    }

    try {
        const startedAt = Date.now();

        let conversationId = input.conversationId;
        if (conversationId) {
            const conversation = getConversationById(conversationId, authedReq.user.id);
            if (!conversation) {
                res.status(404).json({ success: false, message: "会话不存在" });
                return;
            }
        } else {
            conversationId = createConversation(authedReq.user.id, model.id, template.scenario, template.name);
        }

        const historyMessages = getHistoryMessages(conversationId);
        const result = await callZhipu({
            apiKey: input.apiKey,
            model: model.id,
            prompt,
            systemPrompt: template.systemPrompt,
            enableThinking: input.enableThinking ?? model.thinking,
            responseFormat: template.outputFormat,
            historyMessages
        });

        appendMessage(
            conversationId,
            "user",
            [
                "[模板发送]",
                `templateId: ${template.id}`,
                `templateName: ${template.name}`,
                `model: ${model.id}`,
                `variables: ${summarizeTemplateVariables(input.variables)}`
            ].join("\n")
        );
        appendMessage(conversationId, "assistant", result.content, result.reasoning);

        if (authedReq.user) {
            logAudit({
                userId: authedReq.user.id,
                actionModule: "ai",
                actionType: "chat_with_template",
                objectType: "prompt_template",
                detail: {
                    templateId: input.templateId,
                    model: model.id,
                    pricingTier: model.pricingTier,
                    outputFormat: template.outputFormat,
                    conversationId,
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
                answer: result.content,
                reasoning: result.reasoning,
                conversationId,
                model: model.id
            }
        });
    } catch (error) {
        res.status(502).json({ success: false, message: `模型调用失败: ${toPublicErrorMessage(error)}` });
    }
});

aiRouter.post("/chat-with-template-stream", requireAuth, async (req, res) => {
    const authedReq = req as AuthedRequest;
    const parsed = templateChatSchema.safeParse(req.body);
    if (!parsed.success || !authedReq.user) {
        res.status(400).json({ success: false, message: "请求参数不合法" });
        return;
    }

    pruneExpiredConversations();

    const input = parsed.data;
    const template = getTemplateById(input.templateId);
    if (!template) {
        res.status(404).json({ success: false, message: "模板不存在" });
        return;
    }

    const model = getSupportedModelById(input.model ?? DEFAULT_MODEL_ID);
    if (!model) {
        res.status(400).json({ success: false, message: "不支持的模型" });
        return;
    }

    if (template.outputFormat === "json_object" && !model.supportsJsonMode) {
        res.status(400).json({ success: false, message: `模板需要结构化输出，模型 ${model.name} 不支持` });
        return;
    }

    const missingVariables = template.variableMeta
        .map((item) => item.key)
        .filter((key) => !input.variables[key] || input.variables[key].trim().length === 0);

    if (missingVariables.length > 0) {
        res.status(400).json({
            success: false,
            message: `模板变量缺失: ${missingVariables.join(", ")}`
        });
        return;
    }

    let conversationId = input.conversationId;
    if (conversationId) {
        const conversation = getConversationById(conversationId, authedReq.user.id);
        if (!conversation) {
            res.status(404).json({ success: false, message: "会话不存在" });
            return;
        }
    } else {
        conversationId = createConversation(authedReq.user.id, model.id, template.scenario, template.name);
    }

    const prompt = `${fillTemplate(template.template, input.variables)}\n\n输出规范:\n${template.outputSpec}`;
    appendMessage(
        conversationId,
        "user",
        [
            "[模板发送]",
            `templateId: ${template.id}`,
            `templateName: ${template.name}`,
            `model: ${model.id}`,
            `variables: ${summarizeTemplateVariables(input.variables)}`
        ].join("\n")
    );

    const startedAt = Date.now();
    initSse(res);
    sendSse(res, "conversation", { conversationId, model: model.id });

    let closed = false;
    req.on("close", () => {
        closed = true;
    });

    try {
        const historyMessages = getHistoryMessages(conversationId).slice(0, -1);
        const result = await streamZhipu(
            {
                apiKey: input.apiKey,
                model: model.id,
                prompt,
                systemPrompt: template.systemPrompt,
                enableThinking: input.enableThinking ?? model.thinking,
                responseFormat: template.outputFormat,
                historyMessages
            },
            {
                onTextDelta: (delta) => {
                    if (closed) {
                        return;
                    }
                    sendSse(res, "delta", { delta });
                },
                onReasoningDelta: (delta) => {
                    if (closed) {
                        return;
                    }
                    sendSse(res, "reasoning-delta", { delta });
                }
            }
        );

        appendMessage(conversationId, "assistant", result.content, result.reasoning);

        logAudit({
            userId: authedReq.user.id,
            actionModule: "ai",
            actionType: "chat_with_template_stream",
            objectType: "prompt_template",
            detail: {
                templateId: input.templateId,
                model: model.id,
                pricingTier: model.pricingTier,
                outputFormat: template.outputFormat,
                conversationId,
                retryUsed: result.retryUsed ?? false,
                elapsedMs: Date.now() - startedAt
            },
            ipAddress: extractIp(req)
        });

        sendSse(res, "complete", {
            templateId: template.id,
            templateName: template.name,
            answer: result.content,
            reasoning: result.reasoning,
            conversationId,
            model: model.id
        });
    } catch (error) {
        sendSse(res, "error", { message: `模型调用失败: ${toPublicErrorMessage(error)}` });
    } finally {
        res.end();
    }
});
