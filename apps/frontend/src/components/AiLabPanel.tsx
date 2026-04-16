import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import { storage } from "../lib/storage";

type ModelItem = {
    id: string;
    name: string;
    description: string;
    multimodal: boolean;
    thinking: boolean;
};

type PromptTemplate = {
    id: string;
    name: string;
    scenario: "home-school" | "career" | "growth" | "teaching";
    description: string;
    recommendedModels: string[];
    systemPrompt: string;
    template: string;
    outputSpec: string;
    variableMeta: Array<{
        key: string;
        label: string;
        placeholder: string;
        multiline?: boolean;
    }>;
};

export const AiLabPanel = () => {
    const [models, setModels] = useState<ModelItem[]>([]);
    const [templates, setTemplates] = useState<PromptTemplate[]>([]);
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [model, setModel] = useState("glm-4.7-flash");
    const [scenario, setScenario] = useState<PromptTemplate["scenario"]>("career");
    const [selectedTemplateId, setSelectedTemplateId] = useState("");
    const [useTemplate, setUseTemplate] = useState(true);
    const [prompt, setPrompt] = useState("请用简洁中文给出可执行建议。");
    const [variableValues, setVariableValues] = useState<Record<string, string>>({});
    const [multimodalText, setMultimodalText] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [fileUrl, setFileUrl] = useState("");
    const [answer, setAnswer] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const selectedModel = useMemo(() => models.find((item) => item.id === model), [models, model]);
    const selectedTemplate = useMemo(() => templates.find((item) => item.id === selectedTemplateId), [templates, selectedTemplateId]);

    useEffect(() => {
        const loadModels = async () => {
            try {
                const response = await apiRequest<ModelItem[]>("/api/ai/models");
                setModels(response.data);
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载模型失败");
            }
        };

        void loadModels();
    }, []);

    useEffect(() => {
        const loadTemplates = async () => {
            try {
                const response = await apiRequest<PromptTemplate[]>(`/api/ai/prompt-templates?scenario=${scenario}`);
                setTemplates(response.data);
                setSelectedTemplateId(response.data[0]?.id ?? "");
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
    }, [selectedTemplateId, selectedTemplate]);

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

        setLoading(true);
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

            const response = useTemplate && selectedTemplateId
                ? await apiRequest<{ answer: string }>("/api/ai/chat-with-template", {
                        method: "POST",
                        body: JSON.stringify({
                            apiKey: apiKey.trim(),
                            model,
                            templateId: selectedTemplateId,
                            variables: variableValues,
                            enableThinking: selectedModel?.thinking ?? false
                        })
                    })
                : await apiRequest<{ answer: string }>("/api/ai/chat", {
                        method: "POST",
                        body: JSON.stringify({
                            apiKey: apiKey.trim(),
                            model,
                            prompt,
                            multimodal,
                            enableThinking: selectedModel?.thinking ?? false
                        })
                    });

            setAnswer(response.data.answer);
        } catch (err) {
            setError(err instanceof Error ? err.message : "调用失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>AI助手中心（智谱）</h3>
                <p>面向家校、生涯、成长、教研四个场景。你只要填字段，不需要手写 JSON。</p>
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
                            {models.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name} / {item.multimodal ? "多模态" : "文本"} / {item.thinking ? "思考" : "非思考"}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label>
                        场景模板
                        <select value={scenario} onChange={(event) => setScenario(event.target.value as PromptTemplate["scenario"])}>
                            <option value="career">生涯选课</option>
                            <option value="growth">学业成长</option>
                            <option value="home-school">家校沟通</option>
                            <option value="teaching">教研管理</option>
                        </select>
                    </label>

                    <label className="toggle-label">
                        <input type="checkbox" checked={useTemplate} onChange={(event) => setUseTemplate(event.target.checked)} />
                        使用系统预置模板（推荐）
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

                    <button className="primary-btn" type="submit" disabled={loading}>
                        {loading ? "调用中..." : "开始分析"}
                    </button>
                </form>
            </article>

            <article className="panel-card wide">
                <h4>模板说明</h4>
                {selectedTemplate ? (
                    <div className="list-item">
                        <strong>{selectedTemplate.name}</strong>
                        <p>{selectedTemplate.description}</p>
                        <p>系统规则: {selectedTemplate.systemPrompt}</p>
                        <p>输出规范: {selectedTemplate.outputSpec}</p>
                        <p>推荐模型: {selectedTemplate.recommendedModels.join(" / ")}</p>
                    </div>
                ) : (
                    <p>当前场景暂无模板。</p>
                )}
            </article>

            <article className="panel-card wide">
                <h4>模型输出</h4>
                <pre className="answer-box">{answer || "等待调用结果..."}</pre>
            </article>

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
