import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { downloadExport } from "../lib/export";

type Student = {
  id: number;
  studentNo: string;
  name: string;
  grade: string;
  className: string;
  subjectCombination: string;
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

export const CareerPanel = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [majors, setMajors] = useState<MajorRow[]>([]);
  const [model, setModel] = useState("glm-4.7-flash");
  const [error, setError] = useState("");

  const parseBreakdown = (raw: string): ScoreBreakdown | null => {
    try {
      return JSON.parse(raw) as ScoreBreakdown;
    } catch {
      return null;
    }
  };

  const loadStudents = async () => {
    const response = await apiRequest<Student[]>("/api/students");
    setStudents(response.data.slice(0, 40));
    if (!studentId && response.data.length > 0) {
      setStudentId(response.data[0].id);
    }
  };

  const loadMajors = async () => {
    const response = await apiRequest<MajorRow[]>("/api/career/public-data/major-requirements");
    setMajors(response.data);
  };

  const loadRecommendations = async (targetId: number) => {
    const response = await apiRequest<Recommendation[]>(`/api/career/recommendations/${targetId}`);
    setRecommendations(response.data);
  };

  useEffect(() => {
    const load = async () => {
      try {
        await Promise.all([loadStudents(), loadMajors()]);
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

  const generate = async () => {
    if (!studentId) {
      return;
    }

    setError("");
    try {
      await apiRequest("/api/career/recommendations/generate", {
        method: "POST",
        body: JSON.stringify({ studentId, model })
      });
      await loadRecommendations(studentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    }
  };

  return (
    <section className="panel-grid">
      <article className="panel-card wide">
        <h3>生涯规划与选课推荐</h3>
        <div className="inline-form">
          <label>
            选择学生
            <select value={studentId ?? ""} onChange={(event) => setStudentId(Number(event.target.value))}>
              {students.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.grade} · {item.className}
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
          <button className="primary-btn" onClick={generate}>
            生成选课建议
          </button>
          <button
            className="secondary-btn"
            onClick={() => void downloadExport("/api/admin/export/module/career-recommendations", "career-recommendations")}
          >
            导出推荐记录
          </button>
        </div>
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
                  <div className="score-item">
                    <span>science</span>
                    <strong>{breakdown.science}</strong>
                  </div>
                  <div className="score-item">
                    <span>social</span>
                    <strong>{breakdown.social}</strong>
                  </div>
                  <div className="score-item">
                    <span>logic</span>
                    <strong>{breakdown.logic}</strong>
                  </div>
                  <div className="score-item">
                    <span>language</span>
                    <strong>{breakdown.language}</strong>
                  </div>
                  <div className="score-item">
                    <span>stability</span>
                    <strong>{breakdown.stability}</strong>
                  </div>
                  <div className="score-item score-item-brand">
                    <span>confidence</span>
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
