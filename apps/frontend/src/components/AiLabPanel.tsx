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

export const AiLabPanel = () => {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [apiKey, setApiKey] = useState(storage.getApiKey());
  const [model, setModel] = useState("glm-4.7-flash");
  const [prompt, setPrompt] = useState("请根据高中生学业数据生成阶段性学习建议，分3条输出。");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiRequest<ModelItem[]>("/api/ai/models");
        setModels(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载模型失败");
      }
    };

    void load();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      storage.setApiKey(apiKey);
      const response = await apiRequest<{ answer: string }>("/api/ai/chat", {
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
            提示词
            <textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </label>

          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? "调用中..." : "调用模型"}
          </button>
        </form>
      </article>

      <article className="panel-card wide">
        <h4>模型输出</h4>
        <pre className="answer-box">{answer || "等待调用结果..."}</pre>
      </article>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
};
