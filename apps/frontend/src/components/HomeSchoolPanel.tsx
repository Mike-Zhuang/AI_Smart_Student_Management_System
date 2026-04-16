import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

type MessageItem = {
  id: number;
  title: string;
  content: string;
  senderName: string;
  createdAt: string;
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

export const HomeSchoolPanel = () => {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [leaves, setLeaves] = useState<LeaveItem[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ receiverRole: "parent", title: "", content: "" });

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

  return (
    <section className="panel-grid">
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

      <article className="panel-card wide">
        <h3>最新消息</h3>
        <div className="list-box">
          {messages.slice(0, 8).map((item) => (
            <div key={item.id} className="list-item">
              <strong>{item.title}</strong>
              <p>{item.content}</p>
              <small>
                {item.senderName} · {new Date(item.createdAt).toLocaleString()}
              </small>
            </div>
          ))}
        </div>
      </article>

      <article className="panel-card wide">
        <h3>请假审批</h3>
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
