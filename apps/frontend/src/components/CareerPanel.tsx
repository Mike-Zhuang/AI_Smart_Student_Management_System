import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { downloadExport } from "../lib/export";
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

export const CareerPanel = ({ user }: { user: User }) => {
    const navigate = useNavigate();
    const [students, setStudents] = useState<Student[]>([]);
    const [studentId, setStudentId] = useState<number | null>(null);
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [majors, setMajors] = useState<MajorRow[]>([]);
    const [model, setModel] = useState("glm-4.7-flash");
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [selectionSaving, setSelectionSaving] = useState(false);
    const [rules, setRules] = useState<SubjectRules | null>(null);
    const [selectionForm, setSelectionForm] = useState({
        academicStage: "高一下",
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

    const loadMajors = async () => {
        const response = await apiRequest<MajorRow[]>("/api/career/public-data/major-requirements");
        setMajors(response.data);
    };

    const loadRules = async () => {
        const response = await apiRequest<SubjectRules>("/api/students/subject-rules");
        setRules(response.data);
    };

    const loadRecommendations = async (targetId: number) => {
        const response = await apiRequest<Recommendation[]>(`/api/career/recommendations/${targetId}`);
        setRecommendations(response.data);
    };

    useEffect(() => {
        const load = async () => {
            try {
                await Promise.all([loadStudents(), loadMajors()]);
                await loadRules();
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载失败");
            }
        };
        void load();
    }, []);

    useEffect(() => {
        if (!studentId) {
            return;
        }

        void loadRecommendations(studentId);
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

    const canEditSelection = user.role === "admin" || user.role === "teacher" || user.role === "head_teacher" || user.role === "student";

    const selectedStudent = students.find((item) => item.id === studentId);
    const stageOptions = selectedStudent && rules
        ? rules.rules.stageByGrade[selectedStudent.grade] ?? rules.academicStages
        : rules?.academicStages ?? ["高一上", "高一下", "高二", "高三"];

    const saveSelection = async () => {
        if (!studentId) {
            return;
        }

        setError("");
        setSelectionSaving(true);
        try {
            await apiRequest(`/api/students/${studentId}/subject-selection`, {
                method: "PATCH",
                body: JSON.stringify({
                    academicStage: selectionForm.academicStage,
                    firstSelectedSubject: selectionForm.academicStage === "高一上" ? null : selectionForm.firstSelectedSubject,
                    secondSelectedSubject: selectionForm.academicStage === "高一上" ? null : selectionForm.secondSelectedSubject,
                    thirdSelectedSubject: selectionForm.academicStage === "高一上" ? null : selectionForm.thirdSelectedSubject
                })
            });

            await loadStudents();
            if (studentId) {
                await loadRecommendations(studentId);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "保存选课失败");
        } finally {
            setSelectionSaving(false);
        }
    };

    const generate = async () => {
        if (!studentId) {
            return;
        }

        if (!apiKey.trim()) {
            setError("生涯推荐已改为真实 AI 调用，请先填写 API Key");
            return;
        }

        setError("");
        setLoading(true);
        try {
            storage.setApiKey(apiKey.trim());
            await apiRequest("/api/career/recommendations/generate", {
                method: "POST",
                body: JSON.stringify({ studentId, model, apiKey: apiKey.trim() })
            });
            await loadRecommendations(studentId);
        } catch (err) {
            setError(err instanceof Error ? err.message : "生成失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>生涯规划与选课推荐</h3>
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
                        模型
                        <select value={model} onChange={(event) => setModel(event.target.value)}>
                            <option value="glm-4.7-flash">GLM-4.7-Flash</option>
                            <option value="glm-4.1v-thinking-flash">GLM-4.1V-Thinking-Flash</option>
                            <option value="glm-4.6v-flash">GLM-4.6V-Flash</option>
                        </select>
                    </label>
                    <label>
                        API Key
                        <input
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder="请输入可用的 API Key"
                        />
                    </label>
                    <button className="primary-btn" onClick={generate} disabled={loading}>
                        {loading ? "生成中..." : "生成选课建议"}
                    </button>
                    <button
                        className="secondary-btn"
                        onClick={() => void downloadExport("/api/admin/export/module/career-recommendations", "career-recommendations")}
                    >
                        导出推荐记录
                    </button>
                    <button className="secondary-btn" onClick={() => navigate("/dashboard/ai-lab?scenario=career")}>
                        进入AI聊天
                    </button>
                </div>

                <div className="inline-form section-actions">
                    <label>
                        学段
                        <select
                            value={selectionForm.academicStage}
                            onChange={(event) =>
                                setSelectionForm((prev) => ({
                                    ...prev,
                                    academicStage: event.target.value
                                }))
                            }
                            disabled={!canEditSelection || !selectedStudent}
                        >
                            {stageOptions.map((item) => (
                                <option key={item} value={item}>
                                    {item}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        首选科
                        <select
                            value={selectionForm.firstSelectedSubject}
                            onChange={(event) =>
                                setSelectionForm((prev) => ({
                                    ...prev,
                                    firstSelectedSubject: event.target.value
                                }))
                            }
                            disabled={!canEditSelection || selectionForm.academicStage === "高一上"}
                        >
                            <option value="">请选择</option>
                            {(rules?.firstSubjectOptions ?? ["物理", "历史"]).map((item) => (
                                <option key={item} value={item}>
                                    {item}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        再选科1
                        <select
                            value={selectionForm.secondSelectedSubject}
                            onChange={(event) =>
                                setSelectionForm((prev) => ({
                                    ...prev,
                                    secondSelectedSubject: event.target.value
                                }))
                            }
                            disabled={!canEditSelection || selectionForm.academicStage === "高一上"}
                        >
                            <option value="">请选择</option>
                            {(rules?.secondarySubjectOptions ?? ["化学", "生物", "政治", "地理"]).map((item) => (
                                <option key={item} value={item}>
                                    {item}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        再选科2
                        <select
                            value={selectionForm.thirdSelectedSubject}
                            onChange={(event) =>
                                setSelectionForm((prev) => ({
                                    ...prev,
                                    thirdSelectedSubject: event.target.value
                                }))
                            }
                            disabled={!canEditSelection || selectionForm.academicStage === "高一上"}
                        >
                            <option value="">请选择</option>
                            {(rules?.secondarySubjectOptions ?? ["化学", "生物", "政治", "地理"]).map((item) => (
                                <option key={item} value={item}>
                                    {item}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        className="secondary-btn"
                        onClick={() => void saveSelection()}
                        disabled={!canEditSelection || !selectedStudent || selectionSaving}
                    >
                        {selectionSaving ? "保存中..." : "保存学段与选科"}
                    </button>
                </div>

                <p className="muted-text">
                    当前规则：高一上仅九科学习，不可提交选科；高一下/高二/高三按“物理或历史 + 四选二”执行。
                </p>
            </article>

            <article className="panel-card wide">
                <h4>推荐历史</h4>
                <div className="list-box">
                    {recommendations.slice(0, 5).map((item) => (
                        <div className="list-item" key={item.id}>
                            <strong>{item.selectedCombination}</strong>
                            <p>{item.reasoning}</p>
                            <p>建议专业: {item.majorSuggestions}</p>
                            <small>{new Date(item.createdAt).toLocaleString()}</small>
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card wide">
                <h4>理由可解释面板</h4>
                {recommendations.length > 0 ? (
                    (() => {
                        const latest = recommendations[0];
                        const breakdown = parseBreakdown(latest.scoreBreakdown);

                        if (!breakdown) {
                            return <p>当前推荐记录不含结构化解释数据。</p>;
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
                                    <h5>反事实说明</h5>
                                    <p>{breakdown.counterfactual ?? "暂无"}</p>
                                </div>
                            </div>
                        );
                    })()
                ) : (
                    <p>请先生成一条选课建议。</p>
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
