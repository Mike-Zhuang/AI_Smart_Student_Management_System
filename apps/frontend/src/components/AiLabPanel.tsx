import { FormEvent, useEffect, useState } from "react";
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
    template: string;
    outputSpec: string;
};

export const AiLabPanel = () => {
    const [models, setModels] = useState<ModelItem[]>([]);
    const [templates, setTemplates] = useState<PromptTemplate[]>([]);
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [model, setModel] = useState("glm-4.7-flash");
    const [scenario, setScenario] = useState<PromptTemplate["scenario"]>("career");
    const [selectedTemplateId, setSelectedTemplateId] = useState("");
    const [useTemplate, setUseTemplate] = useState(true);
    const [prompt, setPrompt] = useState("请根据高一学生最近三次考试表现，给出分层可执行建议与风险提醒。");
    const [variablesText, setVariablesText] = useState('{\n  "studentData": "姓名: 张晨\n成绩: 数学96, 语文88, 英语83\n兴趣: 机械设计, 机器人"\n}');
    const [answer, setAnswer] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

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

    const selectedTemplate = templates.find((item) => item.id === selectedTemplateId);
    const templateVariables = selectedTemplate
        ? Array.from(selectedTemplate.template.matchAll(/\{\{(\w+)\}\}/g)).map((item) => item[1])
        : [];

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setLoading(true);
        try {
            storage.setApiKey(apiKey);

            const response = useTemplate && selectedTemplateId
                ? await apiRequest<{ answer: string }>("/api/ai/chat-with-template", {
                    method: "POST",
                    body: JSON.stringify({
                        apiKey,
                        model,
                        templateId: selectedTemplateId,
                        variables: variablesText.trim() ? JSON.parse(variablesText) : {},
                        enableThinking: model.includes("thinking") || model === "glm-4.7-flash"
                    })
                })
                : await apiRequest<{ answer: string }>("/api/ai/chat", {
                    method: "POST",
                    body: JSON.stringify({
                        apiKey,
                        model,
                        prompt,
                        enableThinking: model.includes("thinking") || model === "glm-4.7-flash"
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
                <h3>智谱模型接入与切换</h3>
                <p>
                    提供三种模型: GLM-4.7-Flash（思考文本）, GLM-4.1V-Thinking-Flash（思考多模态）, GLM-4.6V-Flash（非思考多模态）。
                </p>
            </article>

            <article className="panel-card wide">
                <form className="form-stack" onSubmit={submit}>
                    <label>
                        智谱 API Key（本地保存）
                        <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="请输入你的 API Key" />
                    </label>

                    <label>
                        模型选择
                        <select value={model} onChange={(event) => setModel(event.target.value)}>
                            {models.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name} · {item.multimodal ? "多模态" : "文本"} · {item.thinking ? "思考" : "非思考"}
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

                    <label>
                        <input type="checkbox" checked={useTemplate} onChange={(event) => setUseTemplate(event.target.checked)} />
                        使用预置提示词模板
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
                            <label>
                                变量 JSON
                                <textarea rows={8} value={variablesText} onChange={(event) => setVariablesText(event.target.value)} />
                            </label>
                        </>
                    ) : null}

                    <label>
                        自定义提示词
                        <textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                    </label>

                    <button className="primary-btn" type="submit" disabled={loading}>
                        {loading ? "调用中..." : "调用模型"}
                    </button>
                </form>
            </article>

            <article className="panel-card wide">
                <h4>模板说明</h4>
                {selectedTemplate ? (
                    <div className="list-item">
                        <strong>{selectedTemplate.name}</strong>
                        <p>{selectedTemplate.description}</p>
                        <p>输出规范: {selectedTemplate.outputSpec}</p>
                        <p>推荐模型: {selectedTemplate.recommendedModels.join(" / ")}</p>
                        <p>变量: {templateVariables.join(", ") || "无"}</p>
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
