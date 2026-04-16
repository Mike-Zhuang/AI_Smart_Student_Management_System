import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiRequest } from "../lib/api";
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
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState<number | null>(user.linkedStudentId);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadStudents = async () => {
      try {
        const response = await apiRequest<Student[]>("/api/students");
        setStudents(response.data.slice(0, 60));
        if (!studentId && response.data.length > 0) {
          setStudentId(response.data[0].id);
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

    const map: Record<string, string> = {
      high: "高风险",
      medium: "中风险",
      low: "低风险"
    };

    return map[profile.profile.riskLevel] ?? profile.profile.riskLevel;
  }, [profile]);

  return (
    <section className="panel-grid">
      <article className="panel-card wide">
        <h3>学生学业成长追踪</h3>
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
      </article>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
};
