import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { getModelCapabilityTags, type StreamCompletePayload, type SupportedModel } from "../lib/ai";
import { consumeSseStream } from "../lib/sse";
import { storage } from "../lib/storage";

type Scenario = "career" | "growth" | "home-school";

type PromptTemplate = {
    id: string;
    name: string;
    scenario: Scenario;
    description: string;
    userGuide: string;
    recommendedModels: string[];
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

const SCENARIO_LABEL: Record<Scenario, string> = {
    career: "生涯发展与选科",
    growth: "学业成长",
    "home-school": "家校沟通"
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
    science: "科学思维",
    social: "社会责任",
    logic: "逻辑推理",
    language: "语言表达",
    stability: "学习稳定性"
};

const isScenario = (value: string | null): value is Scenario => {
    return value === "career" || value === "growth" || value === "home-school";
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

const toLabel = (key: string): string => FIELD_LABEL_MAP[key] ?? key;

const formatStructuredValue = (value: unknown): string => {
    if (Array.isArray(value)) {
        return value.map((item) => formatStructuredValue(item)).join("；");
    }
    if (typeof value === "object" && value !== null) {
        return Object.entries(value as Record<string, unknown>)
            .map(([key, item]) => `${toLabel(key)}：${formatStructuredValue(item)}`)
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
    const [models, setModels] = useState<SupportedModel[]>([]);
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
    const [imageNote, setImageNote] = useState("");
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [followupLoading, setFollowupLoading] = useState(false);
    const [streamingAnswer, setStreamingAnswer] = useState("");
    const [streamingReasoning, setStreamingReasoning] = useState("");
    const [streamUsageText, setStreamUsageText] = useState("");

    const isBusy = submitting || followupLoading;
    const selectedModel = useMemo(() => models.find((item) => item.id === model), [models, model]);
    const selectedTemplate = useMemo(() => templates.find((item) => item.id === selectedTemplateId), [templates, selectedTemplateId]);

    const availableModels = useMemo(() => {
        const streamable = models.filter((item) => item.supportsStreaming);
        if (!useTemplate || !selectedTemplate?.requiresJsonMode) {
            return streamable;
        }
        return streamable.filter((item) => item.supportsJsonMode);
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
        const scenarioParam = searchParams.get("scenario");
        if (isScenario(scenarioParam)) {
            setScenario(scenarioParam);
        }
    }, [searchParams]);

    useEffect(() => {
        const loadModels = async () => {
            try {
                const response = await apiRequest<SupportedModel[]>("/api/ai/models");
                setModels(response.data);
                const defaultModel = response.data.find((item) => item.isDefault)?.id ?? response.data[0]?.id ?? "";
                setModel(defaultModel);
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载模型失败");
            }
        };

        void loadModels();
    }, []);

    useEffect(() => {
        if (!selectedModel) {
            return;
        }
        setEnableThinking(selectedModel.supportsThinking);
        if (!selectedModel.supportsVision) {
            setImageFile(null);
            setImageNote("");
        }
    }, [selectedModel]);

    useEffect(() => {
        const loadTemplates = async () => {
            try {
                const response = await apiRequest<PromptTemplate[]>(`/api/ai/prompt-templates?scenario=${scenario}`);
                setTemplates(response.data);
                setSelectedTemplateId(response.data[0]?.id ?? "");
                setMessages([]);
                setActiveConversationId(null);
                await loadConversations(scenario);
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载模板失败");
            }
        };

        void loadTemplates();
    }, [scenario]);

    useEffect(() => {
        if (!selectedTemplate) {
            return;
        }
        const nextValues: Record<string, string> = {};
        selectedTemplate.variableMeta.forEach((item) => {
            nextValues[item.key] = variableValues[item.key] ?? "";
        });
        setVariableValues(nextValues);
    }, [selectedTemplate, selectedTemplateId]);

    useEffect(() => {
        if (!model) {
            return;
        }
        if (!availableModels.some((item) => item.id === model)) {
            setModel(availableModels[0]?.id ?? "");
        }
    }, [availableModels, model]);

    useEffect(() => {
        if (!activeConversationId) {
            return;
        }
        void loadMessages(activeConversationId);
    }, [activeConversationId]);

    const runStreamRequest = async (
        path: string,
        request: {
            body: BodyInit;
            headers?: Record<string, string>;
        }
    ) => {
        setStreamingAnswer("");
        setStreamingReasoning("");
        setStreamUsageText("");

        return consumeSseStream(
            path,
            {
                method: "POST",
                body: request.body,
                headers: request.headers
            },
            {
                onConversation: (payload) => {
                    if (typeof payload.conversationId === "number") {
                        setActiveConversationId(payload.conversationId);
                    }
                },
                onTextDelta: (delta) => {
                    setStreamingAnswer((prev) => prev + delta);
                },
                onReasoningDelta: (delta) => {
                    setStreamingReasoning((prev) => prev + delta);
                },
                onUsage: (payload) => {
                    const totalTokens = typeof payload.totalTokens === "number" ? payload.totalTokens : undefined;
                    const cachedTokens = typeof payload.cachedTokens === "number" ? payload.cachedTokens : undefined;
                    const nextText = [
                        totalTokens ? `总 Token ${totalTokens}` : "",
                        cachedTokens ? `缓存命中 ${cachedTokens}` : ""
                    ].filter(Boolean).join(" / ");
                    setStreamUsageText(nextText);
                }
            }
        );
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
                setError(`请完善字段：${emptyField.label}`);
                return;
            }
        }

        setSubmitting(true);

        try {
            storage.setApiKey(apiKey.trim());
            let complete: StreamCompletePayload;

            if (useTemplate && selectedTemplateId) {
                complete = await runStreamRequest("/api/ai/chat-with-template-stream", {
                    body: JSON.stringify({
                        apiKey: apiKey.trim(),
                        model,
                        templateId: selectedTemplateId,
                        variables: variableValues,
                        enableThinking: enableThinking && (selectedModel?.supportsThinking ?? false),
                        conversationId: activeConversationId ?? undefined
                    }),
                    headers: {
                        "Content-Type": "application/json"
                    }
                });
            } else if (selectedModel?.supportsVision && imageFile) {
                const formData = new FormData();
                formData.append("apiKey", apiKey.trim());
                formData.append("model", model);
                formData.append("prompt", imageNote.trim() ? `${prompt}\n\n图片补充说明：${imageNote.trim()}` : prompt);
                formData.append("enableThinking", String(enableThinking && (selectedModel?.supportsThinking ?? false)));
                formData.append("scenario", scenario);
                if (activeConversationId) {
                    formData.append("conversationId", String(activeConversationId));
                }
                formData.append("image", imageFile);

                complete = await runStreamRequest("/api/ai/upload-image-chat-stream", {
                    body: formData
                });
            } else {
                complete = await runStreamRequest("/api/ai/chat-stream", {
                    body: JSON.stringify({
                        apiKey: apiKey.trim(),
                        model,
                        prompt,
                        enableThinking: enableThinking && (selectedModel?.supportsThinking ?? false),
                        conversationId: activeConversationId ?? undefined,
                        scenario
                    }),
                    headers: {
                        "Content-Type": "application/json"
                    }
                });
            }

            if (complete.conversationId) {
                setActiveConversationId(complete.conversationId);
                await Promise.all([loadConversations(scenario), loadMessages(complete.conversationId)]);
            }
            setStreamingAnswer("");
            setStreamingReasoning("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "调用失败");
        } finally {
            setSubmitting(false);
        }
    };

    const sendFollowup = async (event: FormEvent) => {
        event.preventDefault();
        setError("");

        if (!followupPrompt.trim()) {
            setError("请输入继续对话内容");
            return;
        }
        if (!apiKey.trim()) {
            setError("请先输入可用的智谱 API Key");
            return;
        }
        if (!activeConversationId) {
            setError("请先发送首条消息后再继续对话");
            return;
        }

        setFollowupLoading(true);
        try {
            storage.setApiKey(apiKey.trim());
            const complete = await runStreamRequest("/api/ai/chat-stream", {
                body: JSON.stringify({
                    apiKey: apiKey.trim(),
                    model,
                    prompt: followupPrompt.trim(),
                    enableThinking: enableThinking && (selectedModel?.supportsThinking ?? false),
                    conversationId: activeConversationId,
                    scenario
                }),
                headers: {
                    "Content-Type": "application/json"
                }
            });
            setFollowupPrompt("");
            if (complete.conversationId) {
                setActiveConversationId(complete.conversationId);
                await Promise.all([loadConversations(scenario), loadMessages(complete.conversationId)]);
            }
            setStreamingAnswer("");
            setStreamingReasoning("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "继续对话失败");
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
            setMessages([]);
            await loadConversations(scenario);
        } catch (err) {
            setError(err instanceof Error ? err.message : "创建会话失败");
        }
    };

    const showVisionUploader = !useTemplate && Boolean(selectedModel?.supportsVision);

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>AI助手中心（全流式）</h3>
                <p>所有前台 AI 功能默认使用流式输出。你会实时看到正文和思考过程逐步生成，视觉模型支持直接上传图片，不再要求填写图片 URL。</p>
            </article>

            <article className="panel-card wide">
                <form className="form-stack" onSubmit={submit}>
                    <label>
                        智谱 API Key（仅保存在本机浏览器）
                        <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="请输入可用的 API Key" />
                    </label>
                    <div className="inline-form">
                        <button type="button" className="secondary-btn" onClick={() => setApiKey(storage.getApiKey())}>使用已保存 Key</button>
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
                                    {item.name} / {getModelCapabilityTags(item).join(" / ")}
                                </option>
                            ))}
                        </select>
                    </label>
                    {selectedModel ? (
                        <div className="warning-box">
                            <strong>{selectedModel.name}</strong>
                            <div className="account-actions" style={{ marginTop: 8 }}>
                                {getModelCapabilityTags(selectedModel).map((item) => <span key={item} className="status-pill">{item}</span>)}
                            </div>
                            <p style={{ marginTop: 8 }}>{selectedModel.description}</p>
                        </div>
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
                        使用系统预置模板
                    </label>

                    {selectedModel?.supportsThinking ? (
                        <label className="toggle-label">
                            <input type="checkbox" checked={enableThinking} onChange={(event) => setEnableThinking(event.target.checked)} />
                            展示模型思考过程
                        </label>
                    ) : null}

                    {useTemplate ? (
                        <>
                            <label>
                                模板选择
                                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                                    {templates.map((item) => (
                                        <option key={item.id} value={item.id}>{item.name}</option>
                                    ))}
                                </select>
                            </label>

                            {selectedTemplate?.requiresJsonMode ? (
                                <p className="muted-text">当前模板需要结构化输出，模型列表已自动过滤为支持 JSON 模式的流式模型。</p>
                            ) : null}

                            {selectedTemplate?.variableMeta.map((item) => (
                                <label key={item.key}>
                                    {item.label}
                                    {item.multiline ? (
                                        <textarea
                                            rows={4}
                                            value={variableValues[item.key] ?? ""}
                                            placeholder={item.placeholder}
                                            onChange={(event) => setVariableValues((prev) => ({ ...prev, [item.key]: event.target.value }))}
                                        />
                                    ) : (
                                        <input
                                            value={variableValues[item.key] ?? ""}
                                            placeholder={item.placeholder}
                                            onChange={(event) => setVariableValues((prev) => ({ ...prev, [item.key]: event.target.value }))}
                                        />
                                    )}
                                </label>
                            ))}
                        </>
                    ) : (
                        <label>
                            输入问题
                            <textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="请输入你想让 AI 帮你分析的问题。" />
                        </label>
                    )}

                    {showVisionUploader ? (
                        <article className="panel-card subtle">
                            <h4>图片上传（请求期暂存）</h4>
                            <p>图片只在本次请求中转成临时 base64 发送给模型，服务器不会永久保存。</p>
                            <label>
                                上传图片
                                <input type="file" accept="image/*" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} />
                            </label>
                            <label>
                                图片补充说明（可选）
                                <textarea rows={3} value={imageNote} onChange={(event) => setImageNote(event.target.value)} placeholder="例如：这是一张成绩单，请先提取关键信息，再给出改进建议。" />
                            </label>
                        </article>
                    ) : null}

                    <button className="primary-btn" type="submit" disabled={isBusy}>
                        {submitting ? "流式生成中..." : "发送首条消息"}
                    </button>
                </form>
            </article>

            <article className="panel-card wide">
                <div className="chat-header">
                    <h4>聊天会话</h4>
                    <button type="button" className="secondary-btn" onClick={() => void createNewConversation()}>新建会话</button>
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
                        {messages.length === 0 && !isBusy ? <p className="muted-text">发送第一条消息后，这里会实时显示聊天记录。</p> : null}
                        {messages.map((item) => {
                            const structured = item.role === "assistant" ? parseStructuredData(item.content) : null;
                            return (
                                <div key={item.id} className={`chat-bubble ${item.role}`}>
                                    <strong>{item.role === "assistant" ? "AI" : "我"}</strong>
                                    {structured ? (
                                        <div className="structured-box">
                                            {Object.entries(structured).map(([key, value]) => (
                                                <div key={key} className="structured-row">
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

                        {isBusy ? (
                            <div className="chat-bubble assistant">
                                <strong>AI（流式）</strong>
                                <p>{streamingAnswer || "模型正在组织回答..."}</p>
                                {streamingReasoning ? (
                                    <details className="reasoning-box" open>
                                        <summary>思考过程（流式）</summary>
                                        <pre>{streamingReasoning}</pre>
                                    </details>
                                ) : null}
                                {streamUsageText ? <small>{streamUsageText}</small> : null}
                            </div>
                        ) : null}

                        {activeConversationId && (messages.length > 0 || conversations.length > 0) ? (
                            <form className="chat-followup-form compact-followup" onSubmit={sendFollowup}>
                                <textarea
                                    rows={3}
                                    placeholder="继续追问，例如：请把回答改成适合家长转发的口吻。"
                                    value={followupPrompt}
                                    onChange={(event) => setFollowupPrompt(event.target.value)}
                                />
                                <button className="primary-btn" type="submit" disabled={isBusy}>
                                    {followupLoading ? "发送中..." : "继续对话"}
                                </button>
                            </form>
                        ) : null}
                    </div>
                </div>
            </article>

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
