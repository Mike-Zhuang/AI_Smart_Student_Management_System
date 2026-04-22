import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiRequest } from "../lib/api";
import type { SupportedModel } from "../lib/ai";
import { riskLevelLabelMap } from "../lib/labels";
import { consumeSseStream } from "../lib/sse";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";

type Student = {
    id: number;
    name: string;
    grade: string;
    className: string;
};

type ProfileData = {
    student: {
        id: number;
        name: string;
        grade: string;
        className: string;
        interests: string;
        careerGoal: string;
    };
    profile: {
        summary: string;
        riskLevel: string;
        lastUpdated: string;
    };
};

type Trend = { examName: string; avgScore: number };

type Alert = {
    id: number;
    alertType: string;
    content: string;
    status: string;
    createdAt: string;
};

export const GrowthPanel = ({ user }: { user: User }) => {
    const navigate = useNavigate();
    const [students, setStudents] = useState<Student[]>([]);
    const [studentId, setStudentId] = useState<number | null>(user.linkedStudentId);
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [trends, setTrends] = useState<Trend[]>([]);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [models, setModels] = useState<SupportedModel[]>([]);
    const [model, setModel] = useState("glm-4.7-flash");
    const [aiSummary, setAiSummary] = useState("");
    const [aiReasoning, setAiReasoning] = useState("");
    const [loadingAi, setLoadingAi] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const loadStudents = async () => {
            try {
                const [studentResp, modelResp] = await Promise.all([
                    apiRequest<Student[]>("/api/students"),
                    apiRequest<SupportedModel[]>("/api/ai/models")
                ]);
                const response = studentResp;
                const ordered = [...response.data].sort((a, b) => b.id - a.id);
                setStudents(ordered);
                const structuredModels = modelResp.data.filter((item) => item.supportsStreaming && item.supportsJsonMode);
                setModels(structuredModels);
                setModel(structuredModels.find((item) => item.isDefault)?.id ?? structuredModels[0]?.id ?? "glm-4.7-flash");
                if (!studentId && ordered.length > 0) {
                    setStudentId(ordered[0].id);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载学生失败");
            }
        };

        void loadStudents();
    }, [studentId]);

    useEffect(() => {
        if (!studentId) {
            return;
        }

        const load = async () => {
            try {
                const [profileResp, trendResp, alertResp] = await Promise.all([
                    apiRequest<ProfileData>(`/api/growth/students/${studentId}/profile`),
                    apiRequest<Trend[]>(`/api/growth/students/${studentId}/trends`),
                    apiRequest<Alert[]>(`/api/growth/students/${studentId}/alerts`)
                ]);
                setProfile(profileResp.data);
                setTrends(trendResp.data);
                setAlerts(alertResp.data);
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载成长数据失败");
            }
        };

        void load();
    }, [studentId]);

    const riskLabel = useMemo(() => {
        if (!profile?.profile.riskLevel) {
            return "--";
        }

        return riskLevelLabelMap[profile.profile.riskLevel] ?? profile.profile.riskLevel;
    }, [profile]);

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>学生学业成长</h3>
                <div className="inline-form">
                    <label>
                        选择学生
                        <select
                            value={studentId ?? ""}
                            onChange={(event) => setStudentId(Number(event.target.value))}
                            disabled={students.length <= 1 && (user.role === "parent" || user.role === "student")}
                        >
                            {students.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name} / {item.grade} / {item.className}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        AI Key（用于风险诊断）
                        <input
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder="请输入可用的 API Key"
                        />
                    </label>
                    <button
                        className="secondary-btn"
                        onClick={async () => {
                            if (!studentId || !apiKey.trim()) {
                                setError("请先选择学生并填写 API Key");
                                return;
                            }

                            try {
                                setLoadingAi(true);
                                setAiSummary("");
                                setAiReasoning("");
                                storage.setApiKey(apiKey.trim());
                                const response = await consumeSseStream(
                                    `/api/growth/students/${studentId}/ai-diagnosis-stream`,
                                    {
                                        method: "POST",
                                        body: JSON.stringify({ apiKey: apiKey.trim(), model }),
                                        headers: { "Content-Type": "application/json" }
                                    },
                                    {
                                        onTextDelta: (delta) => setAiSummary((prev) => prev + delta),
                                        onReasoningDelta: (delta) => setAiReasoning((prev) => prev + delta)
                                    }
                                );
                                if (typeof response.answer === "string" && response.answer.trim()) {
                                    setAiSummary(response.answer);
                                }
                            } catch (err) {
                                setError(err instanceof Error ? err.message : "AI诊断失败");
                            } finally {
                                setLoadingAi(false);
                            }
                        }}
                    >
                        {loadingAi ? "诊断中..." : "AI风险诊断"}
                    </button>
                    <button className="secondary-btn" onClick={() => navigate("/dashboard/ai-lab?scenario=growth")}>
                        进入AI聊天
                    </button>
                    <label>
                        模型
                        <select value={model} onChange={(event) => setModel(event.target.value)}>
                            {models.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name} / {item.pricingTier === "paid" ? "收费" : "免费"}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </article>

            <article className="panel-card">
                <h4>成长画像</h4>
                <p>{profile?.profile.summary}</p>
                <p>风险等级: {riskLabel}</p>
                <p>兴趣: {profile?.student.interests || "--"}</p>
                <p>目标: {profile?.student.careerGoal || "--"}</p>
            </article>

            <article className="panel-card">
                <h4>近期预警</h4>
                <div className="list-box compact">
                    {alerts.slice(0, 4).map((item) => (
                        <div key={item.id} className="list-item">
                            <strong>{item.alertType}</strong>
                            <p>{item.content}</p>
                            <small>{new Date(item.createdAt).toLocaleDateString()}</small>
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card wide">
                <h4>考试均分趋势</h4>
                {trends.length > 0 ? (
                    <div style={{ width: "100%", height: 280 }}>
                        <ResponsiveContainer>
                            <LineChart data={trends}>
                                <XAxis dataKey="examName" />
                                <YAxis domain={[40, 100]} />
                                <Tooltip />
                                <Line type="monotone" dataKey="avgScore" stroke="#c96442" strokeWidth={3} dot={{ r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <p className="muted-text">暂无成绩数据，请先导入成绩。</p>
                )}
            </article>

            {(aiSummary || loadingAi) ? (
                <article className="panel-card wide">
                    <h4>AI 诊断结果（流式）</h4>
                    <pre className="answer-box">{aiSummary || "模型正在逐步分析近期学情..."}</pre>
                    {aiReasoning ? (
                        <details className="reasoning-box" open={loadingAi}>
                            <summary>思考过程</summary>
                            <pre>{aiReasoning}</pre>
                        </details>
                    ) : null}
                </article>
            ) : null}

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
