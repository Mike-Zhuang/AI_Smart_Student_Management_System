import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, resolveApiUrl } from "../lib/api";
import { downloadExport } from "../lib/export";
import { selectionStatusLabelMap } from "../lib/labels";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";

type Student = {
    id: number;
    studentNo: string;
    name: string;
    grade: string;
    className: string;
    subjectCombination: string | null;
    academicStage: string;
    selectionStatus: string;
    firstSelectedSubject: string | null;
    secondSelectedSubject: string | null;
    thirdSelectedSubject: string | null;
};

type Recommendation = {
    id: number;
    selectedCombination: string;
    reasoning: string;
    majorSuggestions: string;
    scoreBreakdown: string;
    createdAt: string;
};

type ScoreBreakdown = {
    science: number;
    social: number;
    logic: number;
    language: number;
    stability: number;
    confidence?: number;
    counterfactual?: string;
    evidenceChain?: Array<{ dimension: string; evidence: string; impact: string }>;
};

type MajorRow = {
    university: string;
    major: string;
    requiredSubjects: string;
    referenceScore: number;
};

type SubjectRules = {
    firstSubjectOptions: string[];
    secondarySubjectOptions: string[];
    academicStages: string[];
    rules: {
        stageByGrade: Record<string, string[]>;
    };
};

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

type StreamCompletePayload = {
    result: {
        selectedCombination: string;
        reasoning: string;
        majorSuggestions: string[];
        scoreBreakdown: ScoreBreakdown;
    };
};

export const CareerPanel = ({ user }: { user: User }) => {
    const navigate = useNavigate();
    const [students, setStudents] = useState<Student[]>([]);
    const [studentId, setStudentId] = useState<number | null>(null);
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [majors, setMajors] = useState<MajorRow[]>([]);
    const [models, setModels] = useState<ModelItem[]>([]);
    const [model, setModel] = useState("glm-4.7-flash");
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [selectionSaving, setSelectionSaving] = useState(false);
    const [rules, setRules] = useState<SubjectRules | null>(null);
    const [streamingAnswer, setStreamingAnswer] = useState("");
    const [supplementalContext, setSupplementalContext] = useState("");
    const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "streaming" | "finalizing">("idle");
    const [selectionForm, setSelectionForm] = useState({
        academicStage: "高一上",
        firstSelectedSubject: "",
        secondSelectedSubject: "",
        thirdSelectedSubject: ""
    });

    const dimensionLabelMap: Record<string, string> = {
        science: "科学思维",
        social: "社会责任",
        logic: "逻辑推理",
        language: "语言表达",
        stability: "学习稳定性"
    };

    const parseBreakdown = (raw: string): ScoreBreakdown | null => {
        try {
            return JSON.parse(raw) as ScoreBreakdown;
        } catch {
            return null;
        }
    };

    const loadStudents = async () => {
        const response = await apiRequest<Student[]>("/api/students");
        const ordered = [...response.data].sort((a, b) => b.id - a.id);
        setStudents(ordered);
        if (!studentId && ordered.length > 0) {
            setStudentId(ordered[0].id);
        }
    };

    const loadRecommendations = async (targetId: number) => {
        const response = await apiRequest<Recommendation[]>(`/api/career/recommendations/${targetId}`);
        setRecommendations(response.data);
    };

    useEffect(() => {
        const load = async () => {
            try {
                const [studentResp, majorResp, ruleResp, modelResp] = await Promise.all([
                    apiRequest<Student[]>("/api/students"),
                    apiRequest<MajorRow[]>("/api/career/public-data/major-requirements"),
                    apiRequest<SubjectRules>("/api/students/subject-rules"),
                    apiRequest<ModelItem[]>("/api/ai/models")
                ]);
                const ordered = [...studentResp.data].sort((a, b) => b.id - a.id);
                setStudents(ordered);
                setMajors(majorResp.data);
                setRules(ruleResp.data);
                const textModels = modelResp.data.filter((item) => item.supportsJsonMode);
                setModels(textModels);
                setModel(textModels.find((item) => item.isDefault)?.id ?? textModels[0]?.id ?? "glm-4.7-flash");
                if (ordered.length > 0) {
                    setStudentId(ordered[0].id);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载选科页面失败");
            }
        };
        void load();
    }, []);

    useEffect(() => {
        if (studentId) {
            void loadRecommendations(studentId);
        }
    }, [studentId]);

    useEffect(() => {
        if (!studentId) {
            return;
        }
        const student = students.find((item) => item.id === studentId);
        if (!student) {
            return;
        }
        setSelectionForm({
            academicStage: student.academicStage,
            firstSelectedSubject: student.firstSelectedSubject ?? "",
            secondSelectedSubject: student.secondSelectedSubject ?? "",
            thirdSelectedSubject: student.thirdSelectedSubject ?? ""
        });
    }, [studentId, students]);

    const selectedStudent = students.find((item) => item.id === studentId);
    const stageOptions = selectedStudent && rules ? rules.rules.stageByGrade[selectedStudent.grade] ?? rules.academicStages : rules?.academicStages ?? [];

    const saveSelection = async () => {
        if (!studentId) {
            return;
        }
        setSelectionSaving(true);
        setError("");
        try {
            await apiRequest(`/api/students/${studentId}/subject-selection`, {
                method: "PATCH",
                body: JSON.stringify(selectionForm)
            });
            await loadStudents();
        } catch (err) {
            setError(err instanceof Error ? err.message : "保存选科失败");
        } finally {
            setSelectionSaving(false);
        }
    };

    const consumeStream = async (payload: unknown): Promise<StreamCompletePayload> => {
        const token = storage.getToken();
        const response = await fetch(resolveApiUrl("/api/career/recommendations/generate-stream"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok || !response.body) {
            const raw = await response.text();
            throw new Error(raw || "流式生成失败");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let complete: StreamCompletePayload | null = null;
        let fallbackResult: StreamCompletePayload | null = null;
        let sawAnyDelta = false;

        const processBlock = (block: string): void => {
            const lines = block.split(/\r?\n/).filter(Boolean);
            const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
            const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
            if (dataLines.length === 0) {
                return;
            }

            const parsed = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
            if (event === "delta" && typeof parsed.delta === "string") {
                sawAnyDelta = true;
                setStreamStatus("streaming");
                setStreamingAnswer((prev) => prev + parsed.delta);
                return;
            }
            if (event === "error") {
                throw new Error(String(parsed.message ?? "生成失败"));
            }
            if (event === "complete") {
                complete = parsed as unknown as StreamCompletePayload;
                fallbackResult = complete;
                if (typeof parsed.answer === "string" && parsed.answer.trim()) {
                    setStreamingAnswer(parsed.answer.trim());
                }
                return;
            }
            if (event === "conversation" && !sawAnyDelta) {
                setStreamStatus("connecting");
            }
            if (parsed.result && typeof parsed.result === "object") {
                fallbackResult = parsed as unknown as StreamCompletePayload;
            }
        };

        const flushBuffer = (): void => {
            const matcher = /\r?\n\r?\n/;
            let matched = buffer.match(matcher);
            while (matched && matched.index !== undefined) {
                const block = buffer.slice(0, matched.index);
                buffer = buffer.slice(matched.index + matched[0].length);
                processBlock(block);
                matched = buffer.match(matcher);
            }
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            flushBuffer();
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
            processBlock(buffer.trim());
        }
        if (complete) {
            return complete;
        }
        const resolvedFallback = fallbackResult;
        if (resolvedFallback) {
            setError("技术告警：未收到明确完成事件，系统已按最终结果完成落库。");
            return resolvedFallback;
        }
        throw new Error("未收到选科建议完成事件");
    };

    const generate = async () => {
        if (!studentId) {
            return;
        }
        if (!apiKey.trim()) {
            setError("请先填写可用的智谱 API Key");
            return;
        }
        setLoading(true);
        setStreamingAnswer("");
        setError("");
        setStreamStatus("connecting");
        try {
            storage.setApiKey(apiKey.trim());
            const complete = await consumeStream({
                studentId,
                model,
                apiKey: apiKey.trim(),
                supplementalContext
            });
            setStreamStatus("finalizing");
            if (complete.result.reasoning && !streamingAnswer.trim()) {
                setStreamingAnswer(complete.result.reasoning);
            }
            await loadRecommendations(studentId);
        } catch (err) {
            setError(err instanceof Error ? err.message : "生成选科建议失败");
        } finally {
            setStreamStatus("idle");
            setLoading(false);
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>生涯发展与选科建议</h3>
                <div className="career-workspace">
                    <div className="career-config-card">
                        <div className="inline-form">
                            <label>
                                选择学生
                                <select value={studentId ?? ""} onChange={(event) => setStudentId(Number(event.target.value))}>
                                    {students.map((item) => (
                                        <option key={item.id} value={item.id}>{item.name} / {item.grade} / {item.className}</option>
                                    ))}
                                </select>
                            </label>
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
                            <label>
                                API Key
                                <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="请输入可用的 API Key" />
                            </label>
                        </div>

                        <div className="inline-form section-actions">
                            <label>
                                学段
                                <select value={selectionForm.academicStage} onChange={(event) => setSelectionForm((prev) => ({ ...prev, academicStage: event.target.value }))}>
                                    {stageOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                                </select>
                            </label>
                            <label>
                                首选科
                                <select value={selectionForm.firstSelectedSubject} onChange={(event) => setSelectionForm((prev) => ({ ...prev, firstSelectedSubject: event.target.value }))}>
                                    <option value="">请选择</option>
                                    {(rules?.firstSubjectOptions ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                                </select>
                            </label>
                            <label>
                                再选科1
                                <select value={selectionForm.secondSelectedSubject} onChange={(event) => setSelectionForm((prev) => ({ ...prev, secondSelectedSubject: event.target.value }))}>
                                    <option value="">请选择</option>
                                    {(rules?.secondarySubjectOptions ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                                </select>
                            </label>
                            <label>
                                再选科2
                                <select value={selectionForm.thirdSelectedSubject} onChange={(event) => setSelectionForm((prev) => ({ ...prev, thirdSelectedSubject: event.target.value }))}>
                                    <option value="">请选择</option>
                                    {(rules?.secondarySubjectOptions ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                                </select>
                            </label>
                        </div>

                        <div className="account-actions section-actions">
                            <button className="primary-btn" onClick={generate} disabled={loading}>
                                {loading ? "生成中..." : "流式生成选科建议"}
                            </button>
                            <button className="secondary-btn" onClick={() => void saveSelection()} disabled={selectionSaving}>
                                {selectionSaving ? "保存中..." : "保存选科确认"}
                            </button>
                            <button className="secondary-btn" onClick={() => void downloadExport("/api/admin/export/module/career-recommendations", "career-recommendations")}>导出建议记录</button>
                            <button className="secondary-btn" onClick={() => navigate("/dashboard/ai-lab?scenario=career")}>进入 AI 助手</button>
                        </div>

                        <p className="muted-text">
                            当前学生：{selectedStudent?.subjectCombination ?? "暂无组合"} / {selectionStatusLabelMap[selectedStudent?.selectionStatus ?? "not_started"] ?? "待完善"}
                        </p>
                    </div>

                    <div className="career-supplement-card">
                        <div className="list-item-header">
                            <div>
                                <h4>自由补充信息</h4>
                                <p className="muted-text">把家庭期望、兴趣变化、老师观察、竞赛经历、身体情况等补充给模型，系统会与成绩一起综合判断。</p>
                            </div>
                            <strong>{supplementalContext.trim().length} 字</strong>
                        </div>
                        <div className="account-actions">
                            {["家庭期望", "兴趣变化", "老师观察", "竞赛经历", "身体情况"].map((item) => (
                                <span key={item} className="status-pill">{item}</span>
                            ))}
                        </div>
                        <textarea
                            className="career-supplement-input"
                            rows={10}
                            value={supplementalContext}
                            onChange={(event) => setSupplementalContext(event.target.value)}
                            placeholder="例如：学生最近对理工类专业兴趣明显提升；数学、物理成绩稳定，英语波动较大；家长更倾向未来报考工科院校；班主任观察到其做实验和解决问题时专注度较高。"
                        />
                        {!supplementalContext.trim() ? <p className="muted-text">当前未补充额外背景，模型将仅结合成绩、现有选科状态和兴趣目标生成建议。</p> : null}
                    </div>
                </div>
            </article>

            {(loading || streamingAnswer) ? (
                <article className="panel-card wide">
                    <h4>生成中的选科建议</h4>
                    <p className="muted-text">
                        {streamStatus === "connecting" ? "正在连接模型..." : streamStatus === "streaming" ? "模型正在流式生成中..." : streamStatus === "finalizing" ? "正在整理最终结果并刷新历史..." : "等待开始"}
                    </p>
                    <pre className="answer-box">{streamingAnswer || "模型正在综合分析成绩、兴趣和补充背景..."}</pre>
                </article>
            ) : null}

            <article className="panel-card wide">
                <h4>建议历史</h4>
                <div className="list-box">
                    {recommendations.slice(0, 5).map((item) => (
                        <div className="list-item" key={item.id}>
                            <strong>{item.selectedCombination}</strong>
                            <p>{item.reasoning}</p>
                            <p>专业方向：{item.majorSuggestions}</p>
                            <small>{new Date(item.createdAt).toLocaleString()}</small>
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card wide">
                <h4>可解释面板</h4>
                {recommendations.length > 0 ? (
                    (() => {
                        const breakdown = parseBreakdown(recommendations[0].scoreBreakdown);
                        if (!breakdown) {
                            return <p>当前记录暂无结构化解释。</p>;
                        }
                        return (
                            <div className="explain-grid">
                                <div className="score-grid">
                                    {(["science", "social", "logic", "language", "stability"] as const).map((key) => (
                                        <div className="score-item" key={key}>
                                            <span>{dimensionLabelMap[key]}</span>
                                            <strong>{breakdown[key]}</strong>
                                        </div>
                                    ))}
                                    <div className="score-item score-item-brand">
                                        <span>置信度</span>
                                        <strong>{breakdown.confidence ?? "--"}</strong>
                                    </div>
                                </div>
                                <div>
                                    <h5>证据链</h5>
                                    <div className="list-box compact">
                                        {(breakdown.evidenceChain ?? []).map((item, index) => (
                                            <div className="list-item" key={`${item.dimension}-${index}`}>
                                                <strong>{item.dimension}</strong>
                                                <p>{item.evidence}</p>
                                                <small>{item.impact}</small>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <h5>反事实分析</h5>
                                    <p>{breakdown.counterfactual ?? "暂无"}</p>
                                </div>
                            </div>
                        );
                    })()
                ) : (
                    <p>请先生成一条选科建议。</p>
                )}
            </article>

            <article className="panel-card wide">
                <h4>公开专业选科要求（节选）</h4>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>高校</th>
                                <th>专业</th>
                                <th>选科要求</th>
                                <th>参考分</th>
                            </tr>
                        </thead>
                        <tbody>
                            {majors.slice(0, 8).map((item, index) => (
                                <tr key={`${item.university}-${item.major}-${index}`}>
                                    <td>{item.university}</td>
                                    <td>{item.major}</td>
                                    <td>{item.requiredSubjects}</td>
                                    <td>{item.referenceScore}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </article>

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
