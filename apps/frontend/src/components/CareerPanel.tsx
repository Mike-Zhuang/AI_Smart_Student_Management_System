import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { type StreamCompletePayload, type SupportedModel } from "../lib/ai";
import { downloadExport } from "../lib/export";
import { selectionStatusLabelMap } from "../lib/labels";
import { consumeSseStream } from "../lib/sse";
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
    matchLevel: "reach" | "match" | "safe";
    matchLevelLabel: string;
    subjectMatched: boolean;
    scoreGap: number;
    admissionScores: Array<{ year: number; score: number; region: string }>;
    averageScore: number;
    minScore: number;
    maxScore: number;
    historyComplete: boolean;
};

type MajorRecommendationResponse = {
    scoreProfile: {
        examKey: string;
        examName: string;
        examDate: string;
        rawScore: number;
        scaledScore: number;
        subjects: string[];
        method: string;
        scoreMode: string;
        examMode: string;
        selectedSubjects: string[];
    };
    recommendations: MajorRow[];
    filters: {
        exams: Array<{ key: string; examName: string; examDate: string }>;
        years: number[];
        matchLevels: Array<{ value: string; label: string }>;
    };
};

type MajorExamMode = "latest" | "specific" | "recent3Weighted" | "trendFit";
type MajorScoreMode = "gaokaoSixSubjectScale" | "allSubjectScale" | "rawTotal" | "manual";
type MajorMatchLevel = "all" | "reach" | "match" | "safe";

type MajorFilters = {
    examMode: MajorExamMode;
    scoreMode: MajorScoreMode;
    examKey: string;
    manualScore: string;
    keyword: string;
    matchLevel: MajorMatchLevel;
};

type SubjectRules = {
    firstSubjectOptions: string[];
    secondarySubjectOptions: string[];
    academicStages: string[];
    rules: {
        stageByGrade: Record<string, string[]>;
    };
};

type CareerStreamCompletePayload = StreamCompletePayload & {
    result: {
        selectedCombination: string;
        reasoning: string;
        majorSuggestions: string[];
        scoreBreakdown: ScoreBreakdown;
    };
};

const looksLikeStructuredJson = (value: string): boolean => {
    const trimmed = value.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
};

export const CareerPanel = ({ user }: { user: User }) => {
    const navigate = useNavigate();
    const [students, setStudents] = useState<Student[]>([]);
    const [studentId, setStudentId] = useState<number | null>(null);
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [majorData, setMajorData] = useState<MajorRecommendationResponse | null>(null);
    const [models, setModels] = useState<SupportedModel[]>([]);
    const [model, setModel] = useState("glm-4.7-flash");
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [selectionSaving, setSelectionSaving] = useState(false);
    const [rules, setRules] = useState<SubjectRules | null>(null);
    const [streamingAnswer, setStreamingAnswer] = useState("");
    const [streamingReasoning, setStreamingReasoning] = useState("");
    const [supplementalContext, setSupplementalContext] = useState("");
    const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "streaming" | "finalizing">("idle");
    const [majorLoading, setMajorLoading] = useState(false);
    const [majorFilters, setMajorFilters] = useState<MajorFilters>({
        examMode: "recent3Weighted",
        scoreMode: "gaokaoSixSubjectScale",
        examKey: "",
        manualScore: "",
        keyword: "",
        matchLevel: "all"
    });
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

    const loadMajorRecommendations = async (targetId: number) => {
        if (majorFilters.scoreMode === "manual" && !majorFilters.manualScore.trim()) {
            setMajorData(null);
            return;
        }

        setMajorLoading(true);
        try {
            const query = new URLSearchParams({
                studentId: String(targetId),
                examMode: majorFilters.examMode,
                scoreMode: majorFilters.scoreMode,
                matchLevel: majorFilters.matchLevel
            });
            if (majorFilters.examKey) {
                query.set("examKey", majorFilters.examKey);
            }
            if (majorFilters.manualScore.trim()) {
                query.set("manualScore", majorFilters.manualScore.trim());
            }
            if (majorFilters.keyword.trim()) {
                query.set("keyword", majorFilters.keyword.trim());
            }
            const response = await apiRequest<MajorRecommendationResponse>(`/api/career/major-recommendations?${query.toString()}`);
            setMajorData(response.data);
            if (!majorFilters.examKey && response.data.filters.exams.length > 0) {
                setMajorFilters((prev) => ({ ...prev, examKey: response.data.filters.exams[response.data.filters.exams.length - 1]?.key ?? "" }));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载院校推荐失败");
        } finally {
            setMajorLoading(false);
        }
    };

    useEffect(() => {
        const load = async () => {
            try {
                const [studentResp, ruleResp, modelResp] = await Promise.all([
                    apiRequest<Student[]>("/api/students"),
                    apiRequest<SubjectRules>("/api/students/subject-rules"),
                    apiRequest<SupportedModel[]>("/api/ai/models")
                ]);
                const ordered = [...studentResp.data].sort((a, b) => b.id - a.id);
                setStudents(ordered);
                setRules(ruleResp.data);
                const textModels = modelResp.data.filter((item) => item.supportsStreaming && item.supportsJsonMode);
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
        if (studentId) {
            void loadMajorRecommendations(studentId);
        }
    }, [studentId, majorFilters.examMode, majorFilters.scoreMode, majorFilters.examKey, majorFilters.manualScore, majorFilters.keyword, majorFilters.matchLevel]);

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

    const consumeStream = async (payload: unknown): Promise<CareerStreamCompletePayload> => {
        return consumeSseStream(
            "/api/career/recommendations/generate-stream",
            {
                method: "POST",
                body: JSON.stringify(payload),
                headers: {
                    "Content-Type": "application/json"
                }
            },
            {
                onConversation: () => {
                    setStreamStatus("connecting");
                },
                onTextDelta: (delta) => {
                    setStreamStatus("streaming");
                    setStreamingAnswer((prev) => prev + delta);
                },
                onReasoningDelta: (delta) => {
                    setStreamStatus("streaming");
                    setStreamingReasoning((prev) => prev + delta);
                }
            }
        ) as Promise<CareerStreamCompletePayload>;
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
        setStreamingReasoning("");
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
            if (typeof complete.answer === "string" && complete.answer.trim() && !looksLikeStructuredJson(complete.answer)) {
                setStreamingAnswer(complete.answer.trim());
            } else if (complete.result.reasoning && !streamingAnswer.trim()) {
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
                                            {item.name} / {item.pricingTier === "paid" ? "收费" : "免费"} / {item.supportsThinking ? "支持思考" : "直出"}
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
                    <div className="chat-bubble assistant">
                        <strong>AI（流式正文）</strong>
                        <pre className="answer-box">{streamingAnswer || "模型正在综合分析成绩、兴趣和补充背景..."}</pre>
                        {streamingReasoning ? (
                            <details className="reasoning-box" open>
                                <summary>思考过程（流式）</summary>
                                <pre>{streamingReasoning}</pre>
                            </details>
                        ) : null}
                    </div>
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
                <h4>推荐院校与近三年录取分</h4>
                <div className="inline-form section-actions">
                    <label>
                        考试范围
                        <select value={majorFilters.examMode} onChange={(event) => setMajorFilters((prev) => ({ ...prev, examMode: event.target.value as MajorExamMode }))}>
                            <option value="recent3Weighted">最近三次加权</option>
                            <option value="trendFit">趋势拟合</option>
                            <option value="latest">最近一次考试</option>
                            <option value="specific">指定考试</option>
                        </select>
                    </label>
                    <label>
                        指定考试
                        <select value={majorFilters.examKey} onChange={(event) => setMajorFilters((prev) => ({ ...prev, examKey: event.target.value, examMode: "specific" }))}>
                            {(majorData?.filters.exams ?? []).map((item) => (
                                <option key={item.key} value={item.key}>{item.examDate} · {item.examName}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        分数口径
                        <select value={majorFilters.scoreMode} onChange={(event) => setMajorFilters((prev) => ({ ...prev, scoreMode: event.target.value as MajorScoreMode }))}>
                            <option value="gaokaoSixSubjectScale">六科折算到750</option>
                            <option value="allSubjectScale">全科折算到750</option>
                            <option value="rawTotal">原始总分</option>
                            <option value="manual">手动输入</option>
                        </select>
                    </label>
                    <label>
                        手动分数
                        <input type="number" min={0} max={750} value={majorFilters.manualScore} onChange={(event) => setMajorFilters((prev) => ({ ...prev, manualScore: event.target.value, scoreMode: event.target.value ? "manual" : prev.scoreMode }))} placeholder="可选" />
                    </label>
                    <label>
                        关键词
                        <input value={majorFilters.keyword} onChange={(event) => setMajorFilters((prev) => ({ ...prev, keyword: event.target.value }))} placeholder="高校或专业" />
                    </label>
                    <label>
                        层级
                        <select value={majorFilters.matchLevel} onChange={(event) => setMajorFilters((prev) => ({ ...prev, matchLevel: event.target.value as MajorMatchLevel }))}>
                            {(majorData?.filters.matchLevels ?? [
                                { value: "all", label: "全部" },
                                { value: "reach", label: "冲刺" },
                                { value: "match", label: "匹配" },
                                { value: "safe", label: "保底" }
                            ]).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                    </label>
                </div>
                {majorData ? (
                    <div className="score-profile-strip">
                        <strong>{majorData.scoreProfile.scaledScore} 分</strong>
                        <span>{majorData.scoreProfile.examName} / {majorData.scoreProfile.subjects.length > 0 ? majorData.scoreProfile.subjects.join("、") : "手动分数"}</span>
                        <small>{majorData.scoreProfile.method}</small>
                    </div>
                ) : null}
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>高校</th>
                                <th>专业</th>
                                <th>选科要求</th>
                                <th>近三年录取分</th>
                                <th>折算分差</th>
                                <th>推荐层级</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(majorData?.recommendations ?? []).map((item, index) => (
                                <tr key={`${item.university}-${item.major}-${index}`}>
                                    <td>{item.university}</td>
                                    <td>{item.major}</td>
                                    <td>{item.requiredSubjects}{item.subjectMatched ? "" : "（当前选科不完全匹配）"}</td>
                                    <td>
                                        {item.admissionScores.map((score) => `${score.year}: ${score.score}`).join(" / ")}
                                        {!item.historyComplete ? <small> · 历史数据不足三年</small> : null}
                                    </td>
                                    <td>{item.scoreGap > 0 ? "+" : ""}{item.scoreGap}（均分 {item.averageScore}）</td>
                                    <td><span className={`status-pill match-${item.matchLevel}`}>{item.matchLevelLabel}</span></td>
                                </tr>
                            ))}
                            {!majorLoading && (majorData?.recommendations ?? []).length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="muted-text">当前筛选条件下暂无匹配院校专业。</td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
                {majorLoading ? <p className="muted-text">正在刷新院校推荐...</p> : null}
            </article>

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
