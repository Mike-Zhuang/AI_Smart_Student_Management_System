import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { downloadExport } from "../lib/export";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";

type MessageItem = {
    id: number;
    title: string;
    content: string;
    senderName: string;
    createdAt: string;
    isRead: number;
};

type LeaveItem = {
    id: number;
    studentName: string;
    className: string;
    reason: string;
    startDate: string;
    endDate: string;
    status: string;
    reviewNote: string;
};

export const HomeSchoolPanel = ({ user }: { user: User }) => {
    const [messages, setMessages] = useState<MessageItem[]>([]);
    const [leaves, setLeaves] = useState<LeaveItem[]>([]);
    const [error, setError] = useState("");
    const [form, setForm] = useState({ receiverRole: "parent", title: "", content: "" });
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [draftMap, setDraftMap] = useState<Record<number, string>>({});

    const load = async () => {
        try {
            const [messageResp, leaveResp] = await Promise.all([
                apiRequest<MessageItem[]>("/api/home-school/messages"),
                apiRequest<LeaveItem[]>("/api/home-school/leave-requests")
            ]);
            setMessages(messageResp.data);
            setLeaves(leaveResp.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载失败");
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const onSend = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        try {
            await apiRequest("/api/home-school/messages", {
                method: "POST",
                body: JSON.stringify(form)
            });
            setForm({ receiverRole: "parent", title: "", content: "" });
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "发送失败");
        }
    };

    const onReview = async (id: number, status: "approved" | "rejected") => {
        try {
            await apiRequest(`/api/home-school/leave-requests/${id}/review`, {
                method: "PATCH",
                body: JSON.stringify({ status, reviewNote: status === "approved" ? "同意" : "请补交材料" })
            });
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "审核失败");
        }
    };

    const markRead = async (id: number) => {
        try {
            await apiRequest(`/api/home-school/messages/${id}/read`, { method: "PATCH" });
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "回执失败");
        }
    };

    const generateDraft = async (id: number) => {
        if (!apiKey.trim()) {
            setError("请先填写 API Key 才能生成 AI 回复草稿");
            return;
        }

        try {
            storage.setApiKey(apiKey.trim());
            const response = await apiRequest<{ draft: string }>(`/api/home-school/messages/${id}/ai-reply-draft`, {
                method: "POST",
                body: JSON.stringify({ apiKey: apiKey.trim(), model: "glm-4.7-flash" })
            });
            setDraftMap((prev) => ({ ...prev, [id]: response.data.draft }));
        } catch (err) {
            setError(err instanceof Error ? err.message : "生成草稿失败");
        }
    };

    return (
        <section className="panel-grid">
            {user.role === "admin" || user.role === "teacher" || user.role === "head_teacher" ? (
                <article className="panel-card wide">
                    <h3>家校消息发送</h3>
                    <form onSubmit={onSend} className="inline-form">
                        <label>
                            角色
                            <select
                                value={form.receiverRole}
                                onChange={(event) => setForm({ ...form, receiverRole: event.target.value })}
                            >
                                <option value="parent">家长</option>
                                <option value="student">学生</option>
                                <option value="teacher">教师</option>
                                <option value="head_teacher">班主任</option>
                            </select>
                        </label>
                        <label>
                            标题
                            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
                        </label>
                        <label>
                            内容
                            <input
                                value={form.content}
                                onChange={(event) => setForm({ ...form, content: event.target.value })}
                                required
                            />
                        </label>
                        <button className="primary-btn" type="submit">
                            发送
                        </button>
                    </form>
                </article>
            ) : (
                <article className="panel-card wide">
                    <h3>家校消息中心</h3>
                    <p>当前身份可查看通知与请假状态，不支持主动群发消息。</p>
                </article>
            )}

            <article className="panel-card wide">
                <h3>最新消息</h3>
                <div className="inline-form section-actions">
                    <button
                        className="secondary-btn"
                        onClick={() => void downloadExport("/api/admin/export/module/messages", "messages")}
                    >
                        导出消息
                    </button>
                </div>
                <div className="list-box">
                    {messages.slice(0, 8).map((item) => (
                        <div key={item.id} className="list-item">
                            <strong>{item.title}</strong>
                            <p>{item.content}</p>
                            <p>状态: {item.isRead ? "已读" : "未读"}</p>
                            {!item.isRead ? (
                                <button className="secondary-btn" onClick={() => void markRead(item.id)}>
                                    标记已读
                                </button>
                            ) : null}
                            {(user.role === "admin" || user.role === "teacher" || user.role === "head_teacher") ? (
                                <div className="inline-form section-actions compact-actions">
                                    <input
                                        value={apiKey}
                                        placeholder="API Key（用于生成回复草稿）"
                                        onChange={(event) => setApiKey(event.target.value)}
                                    />
                                    <button className="secondary-btn" onClick={() => void generateDraft(item.id)}>
                                        AI生成回复草稿
                                    </button>
                                </div>
                            ) : null}
                            {draftMap[item.id] ? <p className="ai-draft">AI草稿: {draftMap[item.id]}</p> : null}
                            <small>
                                {item.senderName} · {new Date(item.createdAt).toLocaleString()}
                            </small>
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card wide">
                <h3>请假审批</h3>
                <div className="inline-form section-actions">
                    <button
                        className="secondary-btn"
                        onClick={() => void downloadExport("/api/admin/export/module/leave-requests", "leave-requests")}
                    >
                        导出请假记录
                    </button>
                </div>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>学生</th>
                                <th>班级</th>
                                <th>时间</th>
                                <th>原因</th>
                                <th>状态</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leaves.map((item) => (
                                <tr key={item.id}>
                                    <td>{item.studentName}</td>
                                    <td>{item.className}</td>
                                    <td>
                                        {item.startDate} - {item.endDate}
                                    </td>
                                    <td>{item.reason}</td>
                                    <td>{item.status}</td>
                                    <td className="btn-row">
                                        <button className="secondary-btn" onClick={() => onReview(item.id, "approved")}>
                                            同意
                                        </button>
                                        <button className="secondary-btn" onClick={() => onReview(item.id, "rejected")}>
                                            驳回
                                        </button>
                                    </td>
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
