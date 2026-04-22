import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest, resolveApiUrl } from "../lib/api";
import { storage } from "../lib/storage";

type ModelItem = {
    id: string;
    name: string;
    description: string;
    multimodal: boolean;
    thinking: boolean;
    supportsJsonMode: boolean;
    pricingTier: "free" | "paid";
    isDefault: boolean;
};

type Scenario = "career" | "growth" | "home-school";

type PromptTemplate = {
    id: string;
    name: string;
    scenario: Scenario;
    description: string;
    userGuide: string;
    recommendedModels: string[];
    outputSpec: string;
    outputFormat: "text" | "json_object";
    requiresJsonMode?: boolean;
    variableMeta: Array<{
        key: string;
        label: string;
        placeholder: string;
        multiline?: boolean;
    }>;
};

type Conversation = {
    id: number;
    title: string | null;
    scenario: string | null;
    model: string;
    createdAt: string;
    updatedAt: string;
};

type ConversationMessage = {
    id: number;
    role: "user" | "assistant";
    content: string;
    reasoning?: string | null;
    createdAt: string;
};

type StreamCompletePayload = {
    answer: string;
    reasoning?: string;
    conversationId: number;
    model: string;
};

const SCENARIO_LABEL: Record<Scenario, string> = {
    career: "生涯发展与选科",
    growth: "学业成长",
    "home-school": "家校沟通"
};

const isScenario = (value: string | null): value is Scenario => {
    return value === "career" || value === "growth" || value === "home-school";
};

const FIELD_LABEL_MAP: Record<string, string> = {
    selectedCombination: "推荐组合",
    summary: "综合结论",
    dimensionScores: "维度评分",
    evidenceChain: "证据链",
    counterfactual: "反事实分析",
    majorSuggestions: "专业建议",
    confidence: "置信度",
    riskLevel: "风险等级",
    riskFactors: "风险因子",
    actions: "干预动作",
    followUp: "后续跟进",
    weeklyPlan: "周计划",
    risks: "风险与缓解",
    dimension: "维度",
    evidence: "证据",
    impact: "影响",
    priority: "优先级",
    action: "行动",
    owner: "负责人",
    timeline: "时间线",
    day: "日期",
    task: "任务",
    metric: "验收指标",
    risk: "风险",
    mitigation: "缓解措施",
    science: "科学思维",
    social: "社会责任",
    logic: "逻辑推理",
    language: "语言表达",
    stability: "学习稳定性"
};

const TEMPLATE_OUTPUT_GUIDE: Record<string, string> = {
    "career-structured-v1": "将展示推荐组合、综合判断、维度评分、证据链、反事实分析、专业建议和置信度。",
    "growth-risk-v1": "将展示风险等级、风险因子、干预动作和后续跟进建议。",
    "home-school-reply-v1": "将生成可直接发送的家校沟通回复草稿。"
};

const toLabel = (key: string): string => {
    return FIELD_LABEL_MAP[key] ?? key;
};

const parseStructuredData = (raw: string): Record<string, unknown> | null => {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
    const source = fenced ? fenced[1].trim() : trimmed;

    try {
        const parsed = JSON.parse(source) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
};

const formatStructuredValue = (value: unknown): string => {
    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
                    return String(item);
                }

                if (typeof item === "object" && item !== null) {
                    return Object.entries(item as Record<string, unknown>)
                        .map(([key, nestedValue]) => `${toLabel(key)}: ${formatStructuredValue(nestedValue)}`)
                        .join("；");
                }

                return "--";
            })
            .join("；");
    }

    if (typeof value === "object" && value !== null) {
        return Object.entries(value as Record<string, unknown>)
            .map(([key, nestedValue]) => `${toLabel(key)}: ${formatStructuredValue(nestedValue)}`)
            .join("；");
    }

    if (typeof value === "boolean") {
        return value ? "是" : "否";
    }

    if (value === null || value === undefined) {
        return "--";
    }

    return String(value);
};

export const AiLabPanel = () => {
    const [searchParams] = useSearchParams();
    const [models, setModels] = useState<ModelItem[]>([]);
    const [templates, setTemplates] = useState<PromptTemplate[]>([]);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [messages, setMessages] = useState<ConversationMessage[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [model, setModel] = useState("");
    const [scenario, setScenario] = useState<Scenario>("career");
    const [selectedTemplateId, setSelectedTemplateId] = useState("");
    const [useTemplate, setUseTemplate] = useState(true);
    const [enableThinking, setEnableThinking] = useState(false);
    const [prompt, setPrompt] = useState("请用简洁中文给出可执行建议。");
    const [followupPrompt, setFollowupPrompt] = useState("");
    const [variableValues, setVariableValues] = useState<Record<string, string>>({});
    const [multimodalText, setMultimodalText] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [fileUrl, setFileUrl] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [followupLoading, setFollowupLoading] = useState(false);
    const [enableStream, setEnableStream] = useState(true);
    const [streamingAnswer, setStreamingAnswer] = useState("");
    const [streamingReasoning, setStreamingReasoning] = useState("");

    const isBusy = submitting || followupLoading;

    const selectedModel = useMemo(() => models.find((item) => item.id === model), [models, model]);
    const selectedTemplate = useMemo(() => templates.find((item) => item.id === selectedTemplateId), [templates, selectedTemplateId]);
    const availableModels = useMemo(() => {
        if (!useTemplate || !selectedTemplate || selectedTemplate.outputFormat !== "json_object") {
            return models;
        }

        return models.filter((item) => item.supportsJsonMode);
    }, [models, selectedTemplate, useTemplate]);

    const loadConversations = async (targetScenario: Scenario) => {
        const response = await apiRequest<Conversation[]>(`/api/ai/conversations?scenario=${targetScenario}`);
        setConversations(response.data);
        if (!activeConversationId && response.data.length > 0) {
            setActiveConversationId(response.data[0].id);
        }
    };

    const loadMessages = async (conversationId: number) => {
        const response = await apiRequest<ConversationMessage[]>(`/api/ai/conversations/${conversationId}/messages`);
        setMessages(response.data);
    };

    useEffect(() => {
        const loadModels = async () => {
            try {
                const response = await apiRequest<ModelItem[]>("/api/ai/models");
                setModels(response.data);
                const defaultModel = response.data.find((item) => item.isDefault)?.id ?? response.data[0]?.id;
                if (defaultModel) {
                    setModel(defaultModel);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载模型失败");
            }
        };

        void loadModels();
    }, []);

    useEffect(() => {
        if (selectedModel?.thinking) {
            setEnableThinking(true);
            return;
        }

        setEnableThinking(false);
    }, [selectedModel?.id, selectedModel?.thinking]);

    useEffect(() => {
        const scenarioParam = searchParams.get("scenario");
        if (isScenario(scenarioParam)) {
            setScenario(scenarioParam);
        }
    }, [searchParams]);

    useEffect(() => {
        const loadTemplates = async () => {
            try {
                const response = await apiRequest<PromptTemplate[]>(`/api/ai/prompt-templates?scenario=${scenario}`);
                setTemplates(response.data);
                setSelectedTemplateId(response.data[0]?.id ?? "");
                await loadConversations(scenario);
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载模板失败");
            }
        };

        setMessages([]);
        setActiveConversationId(null);
        void loadTemplates();
    }, [scenario]);

    useEffect(() => {
        if (!activeConversationId) {
            return;
        }

        void loadMessages(activeConversationId);
    }, [activeConversationId]);

    useEffect(() => {
        if (!selectedTemplate) {
            return;
        }

        const nextValues: Record<string, string> = {};
        selectedTemplate.variableMeta.forEach((item) => {
            nextValues[item.key] = variableValues[item.key] ?? "";
        });
        setVariableValues(nextValues);
    }, [selectedTemplateId, selectedTemplate]);

    useEffect(() => {
        if (!model) {
            return;
        }

        const inAvailable = availableModels.some((item) => item.id === model);
        if (!inAvailable) {
            setModel(availableModels[0]?.id ?? "");
        }
    }, [availableModels, model]);

    const consumeStream = async (path: string, payload: unknown): Promise<StreamCompletePayload> => {
        const token = storage.getToken();
        const response = await fetch(resolveApiUrl(path), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(payload)
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

        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            let sep = buffer.indexOf("\n\n");
            while (sep !== -1) {
                const block = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);

                const lines = block.split(/\r?\n/);
                const eventLine = lines.find((line) => line.startsWith("event:"));
                const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());

                if (!eventLine || dataLines.length === 0) {
                    sep = buffer.indexOf("\n\n");
                    continue;
                }

                const event = eventLine.slice(6).trim();
                const rawData = dataLines.join("");

                try {
                    const parsed = JSON.parse(rawData) as Record<string, unknown>;
                    if (event === "conversation" && typeof parsed.conversationId === "number") {
                        setActiveConversationId(parsed.conversationId);
                    }

                    if (event === "delta" && typeof parsed.delta === "string") {
                        setStreamingAnswer((prev) => prev + parsed.delta);
                    }

                    if (event === "reasoning-delta" && typeof parsed.delta === "string") {
                        setStreamingReasoning((prev) => prev + parsed.delta);
                    }

                    if (event === "error") {
                        throw new Error(typeof parsed.message === "string" ? parsed.message : "流式调用失败");
                    }

                    if (event === "complete") {
                        completePayload = parsed as unknown as StreamCompletePayload;
                    }
                } catch (err) {
                    throw err instanceof Error ? err : new Error("流式事件解析失败");
                }

                sep = buffer.indexOf("\n\n");
            }
        }

        if (!completePayload) {
            throw new Error("流式会话异常结束，未收到完成事件");
        }

        return completePayload;
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError("");

        if (!apiKey.trim()) {
            setError("请先输入可用的智谱 API Key");
            return;
        }

        if (useTemplate && selectedTemplate) {
            const emptyField = selectedTemplate.variableMeta.find((item) => !variableValues[item.key]?.trim());
            if (emptyField) {
                setError(`请完善字段: ${emptyField.label}`);
                return;
            }
        }

        setSubmitting(true);
        setStreamingAnswer("");
        setStreamingReasoning("");
        try {
            storage.setApiKey(apiKey.trim());

            const multimodal: Array<{
                type: "text" | "image_url" | "file_url";
                text?: string;
                image_url?: { url: string };
                file_url?: { url: string };
            }> = [];
            if (selectedModel?.multimodal) {
                if (multimodalText.trim()) {
                    multimodal.push({ type: "text", text: multimodalText.trim() });
                }
                if (imageUrl.trim()) {
                    multimodal.push({ type: "image_url", image_url: { url: imageUrl.trim() } });
                }
                if (fileUrl.trim()) {
                    multimodal.push({ type: "file_url", file_url: { url: fileUrl.trim() } });
                }
            }

            const requestPayload = useTemplate && selectedTemplateId
                ? {
                    apiKey: apiKey.trim(),
                    model,
                    templateId: selectedTemplateId,
                    variables: variableValues,
                    enableThinking: enableThinking && (selectedModel?.thinking ?? false),
                    conversationId: activeConversationId ?? undefined
                }
                : {
                    apiKey: apiKey.trim(),
                    model,
                    prompt,
                    multimodal,
                    enableThinking: enableThinking && (selectedModel?.thinking ?? false),
                    conversationId: activeConversationId ?? undefined,
                    scenario
                };

            const complete = enableStream
                ? await consumeStream(
                    useTemplate && selectedTemplateId ? "/api/ai/chat-with-template-stream" : "/api/ai/chat-stream",
                    requestPayload
                )
                : (useTemplate && selectedTemplateId
                    ? (await apiRequest<{ answer: string; reasoning?: string; conversationId: number }>("/api/ai/chat-with-template", {
                        method: "POST",
                        body: JSON.stringify(requestPayload)
                    })).data
                    : (await apiRequest<{ answer: string; reasoning?: string; conversationId: number }>("/api/ai/chat", {
                        method: "POST",
                        body: JSON.stringify(requestPayload)
                    })).data);

            setActiveConversationId(complete.conversationId);
            await Promise.all([loadConversations(scenario), loadMessages(complete.conversationId)]);
            setStreamingAnswer("");
            setStreamingReasoning("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "调用失败");
            setStreamingAnswer("");
            setStreamingReasoning("");
        } finally {
            setSubmitting(false);
        }
    };

    const sendFollowup = async (event: FormEvent) => {
        event.preventDefault();
        setError("");

        if (!followupPrompt.trim()) {
            setError("请输入你要继续追问的内容");
            return;
        }

        if (!apiKey.trim()) {
            setError("请先输入可用的智谱 API Key");
            return;
        }

        if (!activeConversationId) {
            setError("请先发送首条消息或点击“新建会话”后再继续对话");
            return;
        }

        setFollowupLoading(true);
        setStreamingAnswer("");
        setStreamingReasoning("");
        try {
            storage.setApiKey(apiKey.trim());
            const payload = {
                apiKey: apiKey.trim(),
                model,
                prompt: followupPrompt.trim(),
                enableThinking: enableThinking && (selectedModel?.thinking ?? false),
                conversationId: activeConversationId ?? undefined,
                scenario
            };

            const response = enableStream
                ? await consumeStream("/api/ai/chat-stream", payload)
                : (await apiRequest<{ answer: string; reasoning?: string; conversationId: number }>("/api/ai/chat", {
                    method: "POST",
                    body: JSON.stringify(payload)
                })).data;

            setFollowupPrompt("");
            setActiveConversationId(response.conversationId);
            await Promise.all([loadConversations(scenario), loadMessages(response.conversationId)]);
            setStreamingAnswer("");
            setStreamingReasoning("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "续聊失败");
            setStreamingAnswer("");
            setStreamingReasoning("");
        } finally {
            setFollowupLoading(false);
        }
    };

    const createNewConversation = async () => {
        setError("");
        try {
            const response = await apiRequest<{ conversationId: number }>("/api/ai/conversations", {
                method: "POST",
                body: JSON.stringify({
                    scenario,
                    model: model || undefined,
                    title: `${SCENARIO_LABEL[scenario]}会话`
                })
            });
            setActiveConversationId(response.data.conversationId);
            await Promise.all([loadConversations(scenario), loadMessages(response.data.conversationId)]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "创建会话失败");
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>AI助手中心（智谱）</h3>
                <p>支持会话历史、上下文续聊与流式输出。默认优先免费模型，也可按需切换收费模型。</p>
            </article>

            <article className="panel-card wide">
                <form className="form-stack" onSubmit={submit}>
                    <label>
                        智谱 API Key（仅保存在本机浏览器）
                        <input
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder="请输入可用的 API Key"
                        />
                    </label>

                    <div className="inline-form">
                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => setApiKey(storage.getApiKey())}
                        >
                            使用已保存 Key
                        </button>
                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => {
                                storage.removeApiKey();
                                setApiKey("");
                            }}
                        >
                            清除本地 Key
                        </button>
                    </div>

                    <label>
                        模型选择
                        <select value={model} onChange={(event) => setModel(event.target.value)}>
                            {availableModels.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name} / {item.pricingTier === "paid" ? "收费" : "免费"} / {item.multimodal ? "多模态" : "文本"}
                                </option>
                            ))}
                        </select>
                    </label>

                    {useTemplate && selectedTemplate?.outputFormat === "json_object" ? (
                        <p className="muted-text">当前模板需要结构化输出，已自动过滤不支持结构化的模型选项。</p>
                    ) : null}

                    <label>
                        场景
                        <select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>
                            <option value="career">生涯发展与选科</option>
                            <option value="growth">学业成长</option>
                            <option value="home-school">家校沟通</option>
                        </select>
                    </label>

                    <label className="toggle-label">
                        <input type="checkbox" checked={useTemplate} onChange={(event) => setUseTemplate(event.target.checked)} />
                        使用系统预置模板（推荐）
                    </label>

                    {selectedModel?.thinking ? (
                        <label className="toggle-label">
                            <input
                                type="checkbox"
                                checked={enableThinking}
                                onChange={(event) => setEnableThinking(event.target.checked)}
                            />
                            启用思考模式（可在回复中查看思考过程）
                        </label>
                    ) : null}

                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={enableStream}
                            onChange={(event) => setEnableStream(event.target.checked)}
                        />
                        启用流式输出（逐字显示回复）
                    </label>

                    {useTemplate ? (
                        <>
                            <label>
                                模板选择
                                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                                    {templates.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            {selectedTemplate?.variableMeta.map((item) => (
                                <label key={item.key}>
                                    {item.label}
                                    {item.multiline ? (
                                        <textarea
                                            rows={4}
                                            value={variableValues[item.key] ?? ""}
                                            placeholder={item.placeholder}
                                            onChange={(event) =>
                                                setVariableValues((prev) => ({
                                                    ...prev,
                                                    [item.key]: event.target.value
                                                }))
                                            }
                                        />
                                    ) : (
                                        <input
                                            value={variableValues[item.key] ?? ""}
                                            placeholder={item.placeholder}
                                            onChange={(event) =>
                                                setVariableValues((prev) => ({
                                                    ...prev,
                                                    [item.key]: event.target.value
                                                }))
                                            }
                                        />
                                    )}
                                </label>
                            ))}
                        </>
                    ) : (
                        <label>
                            自定义提示词
                            <textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                        </label>
                    )}

                    {selectedModel?.multimodal ? (
                        <article className="panel-card subtle">
                            <h4>多模态输入（可选）</h4>
                            <p>适合上传图片链接或文档链接，让模型理解通知单、成绩单截图等内容。</p>
                            <label>
                                场景补充说明
                                <textarea
                                    rows={3}
                                    placeholder="例如：这是一张月考成绩单，请提取分数并给出改进建议"
                                    value={multimodalText}
                                    onChange={(event) => setMultimodalText(event.target.value)}
                                />
                            </label>
                            <label>
                                图片 URL
                                <input
                                    placeholder="https://..."
                                    value={imageUrl}
                                    onChange={(event) => setImageUrl(event.target.value)}
                                />
                            </label>
                            <label>
                                文档 URL
                                <input
                                    placeholder="https://..."
                                    value={fileUrl}
                                    onChange={(event) => setFileUrl(event.target.value)}
                                />
                            </label>
                        </article>
                    ) : null}

                    <button className="primary-btn" type="submit" disabled={isBusy}>
                        {submitting ? "调用中..." : "开始分析"}
                    </button>
                </form>
            </article>

            <article className="panel-card wide">
                <h4>模板说明</h4>
                {selectedTemplate ? (
                    <div className="list-item">
                        <strong>{selectedTemplate.name}</strong>
                        <p>{selectedTemplate.description}</p>
                        <p>{selectedTemplate.userGuide}</p>
                        <p>结果说明: {TEMPLATE_OUTPUT_GUIDE[selectedTemplate.id] ?? "系统会自动转成易读内容展示。"}</p>
                        <p>输出类型: {selectedTemplate.outputFormat === "json_object" ? "结构化" : "文本"}</p>
                        <p>推荐模型: {selectedTemplate.recommendedModels.join(" / ")}</p>
                        <details className="template-advanced">
                            <summary>查看高级格式规范</summary>
                            <pre>{selectedTemplate.outputSpec}</pre>
                        </details>
                    </div>
                ) : (
                    <p>当前场景暂无模板。</p>
                )}
            </article>

            <article className="panel-card wide">
                <div className="chat-header">
                    <h4>聊天会话</h4>
                    <button type="button" className="secondary-btn" onClick={() => void createNewConversation()}>
                        新建会话
                    </button>
                </div>

                <div className="ai-chat-layout">
                    <aside className="chat-session-list">
                        {conversations.length === 0 ? <p className="muted-text">暂无会话</p> : null}
                        {conversations.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className={`chat-session-item ${activeConversationId === item.id ? "active" : ""}`}
                                onClick={() => setActiveConversationId(item.id)}
                            >
                                <strong>{item.title || "未命名会话"}</strong>
                                <small>{new Date(item.updatedAt).toLocaleString()}</small>
                            </button>
                        ))}
                    </aside>

                    <div className="chat-stream">
                        {messages.length === 0 ? <p className="muted-text">发送第一条消息后，会话记录会显示在这里。</p> : null}
                        {messages.map((item) => {
                            const structured = item.role === "assistant" ? parseStructuredData(item.content) : null;

                            return (
                                <div key={item.id} className={`chat-bubble ${item.role}`}>
                                    <strong>{item.role === "assistant" ? "AI" : "我"}</strong>
                                    {structured ? (
                                        <div className="structured-box">
                                            {Object.entries(structured).map(([key, value]) => (
                                                <div className="structured-row" key={key}>
                                                    <span>{toLabel(key)}</span>
                                                    <span>{formatStructuredValue(value)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p>{item.content}</p>
                                    )}
                                    {item.reasoning ? (
                                        <details className="reasoning-box">
                                            <summary>查看思考过程</summary>
                                            <pre>{item.reasoning}</pre>
                                        </details>
                                    ) : null}
                                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                                </div>
                            );
                        })}
                        {submitting ? <p className="muted-text">AI 正在生成首条回复...</p> : null}
                        {followupLoading ? <p className="muted-text">AI 正在继续对话...</p> : null}

                        {(submitting || followupLoading) && (streamingAnswer || streamingReasoning) ? (
                            <div className="chat-bubble assistant">
                                <strong>AI（流式）</strong>
                                {streamingAnswer ? <p>{streamingAnswer}</p> : <p>正在生成正文...</p>}
                                {streamingReasoning ? (
                                    <details className="reasoning-box" open>
                                        <summary>思考过程（流式）</summary>
                                        <pre>{streamingReasoning}</pre>
                                    </details>
                                ) : null}
                            </div>
                        ) : null}

                        <form className="chat-followup-form" onSubmit={sendFollowup}>
                            <textarea
                                rows={3}
                                placeholder="模板发送后可继续追问，例如：请把建议改成家长可直接执行的3条行动。"
                                value={followupPrompt}
                                onChange={(event) => setFollowupPrompt(event.target.value)}
                            />
                            <button className="primary-btn" type="submit" disabled={isBusy}>
                                {followupLoading ? "发送中..." : "继续对话"}
                            </button>
                        </form>
                    </div>
                </div>
            </article>

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
