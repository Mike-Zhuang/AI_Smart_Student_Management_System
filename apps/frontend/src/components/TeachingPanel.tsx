import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { downloadExport } from "../lib/export";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";

type Task = {
    id: number;
    title: string;
    taskType: string;
    status: string;
    dueDate: string;
    teacherName?: string;
};

type Research = {
    id: number;
    title: string;
    content: string;
    category: string;
    performanceScore: number;
    teacherName?: string;
};

type Analytics = {
    taskStats: Array<{ status: string; count: number }>;
    avgResearchScore: number;
};

export const TeachingPanel = ({ user }: { user: User }) => {
    const navigate = useNavigate();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [research, setResearch] = useState<Research[]>([]);
    const [analytics, setAnalytics] = useState<Analytics | null>(null);
    const [error, setError] = useState("");
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [aiPlanMap, setAiPlanMap] = useState<Record<number, string>>({});
    const [form, setForm] = useState({
        title: "",
        taskType: "lesson_plan",
        dueDate: "2026-05-01"
    });

    const load = async () => {
        try {
            const [taskResp, researchResp, analyticsResp] = await Promise.all([
                apiRequest<Task[]>("/api/teaching/tasks"),
                apiRequest<Research[]>("/api/teaching/research"),
                apiRequest<Analytics>("/api/teaching/analytics")
            ]);
            setTasks(taskResp.data);
            setResearch(researchResp.data);
            setAnalytics(analyticsResp.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载失败");
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const createTask = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        try {
            await apiRequest("/api/teaching/tasks", {
                method: "POST",
                body: JSON.stringify(form)
            });
            setForm({ title: "", taskType: "lesson_plan", dueDate: "2026-05-01" });
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "创建失败");
        }
    };

    const generateAiPlan = async (taskId: number) => {
        if (!apiKey.trim()) {
            setError("请先填写 API Key 才能生成 AI 执行计划");
            return;
        }

        try {
            storage.setApiKey(apiKey.trim());
            const response = await apiRequest<{ answer: string }>(`/api/teaching/tasks/${taskId}/ai-plan`, {
                method: "POST",
                body: JSON.stringify({ apiKey: apiKey.trim(), model: "glm-4.7-flash" })
            });
            setAiPlanMap((prev) => ({ ...prev, [taskId]: response.data.answer }));
        } catch (err) {
            setError(err instanceof Error ? err.message : "生成失败");
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>教师教学教研管理</h3>
                <form className="inline-form" onSubmit={createTask}>
                    <label>
                        任务标题
                        <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
                    </label>
                    <label>
                        任务类型
                        <select value={form.taskType} onChange={(event) => setForm({ ...form, taskType: event.target.value })}>
                            <option value="lesson_plan">备课</option>
                            <option value="research">教研</option>
                            <option value="communication">家校沟通</option>
                            <option value="training">培训</option>
                        </select>
                    </label>
                    <label>
                        截止日期
                        <input
                            type="date"
                            value={form.dueDate}
                            onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                            required
                        />
                    </label>
                    <button className="primary-btn" type="submit">
                        新建任务
                    </button>
                    <button
                        className="secondary-btn"
                        type="button"
                        onClick={() => void downloadExport("/api/admin/export/module/teaching-tasks", "teaching-tasks")}
                    >
                        导出任务记录
                    </button>
                </form>
                <div className="inline-form section-actions">
                    <label>
                        AI Key（用于任务优化）
                        <input
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder="请输入可用的 API Key"
                        />
                    </label>
                    <p>{user.role === "head_teacher" ? "你当前是班主任角色，可联动班级治理任务。" : "你当前是教师角色，重点优化教学与教研任务。"}</p>
                    <button className="secondary-btn" type="button" onClick={() => navigate("/dashboard/ai-lab?scenario=teaching")}>
                        进入AI聊天
                    </button>
                </div>
            </article>

            <article className="panel-card">
                <h4>任务统计</h4>
                <div className="role-grid">
                    {analytics?.taskStats.map((item) => (
                        <div className="role-item" key={item.status}>
                            <span>{item.status}</span>
                            <strong>{item.count}</strong>
                        </div>
                    ))}
                </div>
                <p>教研平均绩效分: {analytics?.avgResearchScore ?? 0}</p>
            </article>

            <article className="panel-card">
                <h4>任务列表</h4>
                <div className="list-box compact">
                    {tasks.slice(0, 6).map((item) => (
                        <div key={item.id} className="list-item">
                            <strong>{item.title}</strong>
                            <p>
                                {item.taskType} · {item.status}
                            </p>
                            <small>{item.dueDate}</small>
                            <div className="inline-form compact-actions">
                                <button className="secondary-btn" type="button" onClick={() => void generateAiPlan(item.id)}>
                                    AI生成执行计划
                                </button>
                            </div>
                            {aiPlanMap[item.id] ? <p className="ai-draft">AI建议: {aiPlanMap[item.id]}</p> : null}
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card wide">
                <h4>教研成果</h4>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>标题</th>
                                <th>分类</th>
                                <th>绩效分</th>
                                <th>内容</th>
                            </tr>
                        </thead>
                        <tbody>
                            {research.map((item) => (
                                <tr key={item.id}>
                                    <td>{item.title}</td>
                                    <td>{item.category}</td>
                                    <td>{item.performanceScore}</td>
                                    <td>{item.content}</td>
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
