import { useEffect, useMemo, useState } from "react";
import { downloadExport } from "../lib/export";
import { apiRequest } from "../lib/api";

type WorkbenchData = {
  className: string;
  todoFunnel: Array<{ stage: string; count: number }>;
  riskStudents: Array<{
    id: number;
    name: string;
    className: string;
    riskLevel: "high" | "medium" | "low";
    summary: string;
    avgScore: number;
  }>;
  receiptStats: {
    totalMessages: number;
    readMessages: number;
    unreadMessages: number;
    receiptRate: number;
  };
  recentActions: Array<{
    id: number;
    actionModule: string;
    actionType: string;
    objectType: string;
    createdAt: string;
    operatorName: string;
  }>;
};

export const HeadTeacherPanel = () => {
  const [className, setClassName] = useState("");
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const query = className ? `?className=${encodeURIComponent(className)}` : "";
      const response = await apiRequest<WorkbenchData>(`/api/teaching/head-teacher/workbench${query}`);
      setData(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const riskSummary = useMemo(() => {
    if (!data) {
      return { high: 0, medium: 0 };
    }

    return data.riskStudents.reduce(
      (acc, cur) => {
        if (cur.riskLevel === "high") acc.high += 1;
        if (cur.riskLevel === "medium") acc.medium += 1;
        return acc;
      },
      { high: 0, medium: 0 }
    );
  }, [data]);

  return (
    <section className="panel-grid">
      <article className="panel-card wide">
        <h3>班主任工作台（细颗粒）</h3>
        <div className="inline-form">
          <label>
            班级筛选
            <input
              placeholder="例如：高二(1)班"
              value={className}
              onChange={(event) => setClassName(event.target.value)}
            />
          </label>
          <button className="primary-btn" onClick={() => void load()}>
            刷新数据
          </button>
          <button
            className="secondary-btn"
            onClick={() => void downloadExport("/api/admin/export/evidence-report", "evidence-report", "json")}
          >
            导出评比汇总
          </button>
        </div>
      </article>

      <article className="panel-card">
        <h4>待办漏斗</h4>
        <div className="funnel-list">
          {data?.todoFunnel.map((item) => (
            <div className="funnel-item" key={item.stage}>
              <span>{item.stage}</span>
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>
      </article>

      <article className="panel-card">
        <h4>家校回执统计</h4>
        <p>总消息: {data?.receiptStats.totalMessages ?? 0}</p>
        <p>已读: {data?.receiptStats.readMessages ?? 0}</p>
        <p>未读: {data?.receiptStats.unreadMessages ?? 0}</p>
        <p>回执率: {Math.round((data?.receiptStats.receiptRate ?? 0) * 100)}%</p>
      </article>

      <article className="panel-card wide">
        <h4>风险学生清单</h4>
        <p>
          高风险 {riskSummary.high} 人 · 中风险 {riskSummary.medium} 人
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>班级</th>
                <th>风险等级</th>
                <th>均分</th>
                <th>触发摘要</th>
              </tr>
            </thead>
            <tbody>
              {data?.riskStudents.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.className}</td>
                  <td>{item.riskLevel}</td>
                  <td>{item.avgScore}</td>
                  <td>{item.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel-card wide">
        <h4>最近操作轨迹（审计）</h4>
        <div className="list-box compact">
          {data?.recentActions.map((item) => (
            <div className="list-item" key={item.id}>
              <strong>{item.actionModule}</strong>
              <p>
                {item.operatorName} 执行 {item.actionType} ({item.objectType})
              </p>
              <small>{new Date(item.createdAt).toLocaleString()}</small>
            </div>
          ))}
        </div>
      </article>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
};
