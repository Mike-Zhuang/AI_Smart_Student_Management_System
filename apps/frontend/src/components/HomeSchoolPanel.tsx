import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import type { SupportedModel } from "../lib/ai";
import { leaveStatusLabelMap, leaveTypeLabelMap, mapLabel, parentConfirmStatusLabelMap } from "../lib/labels";
import { downloadExport } from "../lib/export";
import { consumeSseStream } from "../lib/sse";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";
import { ConfirmActionButton } from "./ConfirmActionButton";

type MessageItem = {
    id: number;
    title: string;
    content: string;
    senderName: string;
    createdAt: string;
    isRead: number;
};

type StudentOption = { id: number; name: string; grade: string; className: string };

type LeaveTimeline = { step: string; status: string; note?: string | null; time?: string | null };
type LeaveItem = {
    id: number;
    studentId: number;
    studentName: string;
    className: string;
    leaveType: string;
    reason: string;
    startAt: string;
    endAt: string;
    contactPhone: string;
    emergencyContact: string;
    status: string;
    parentConfirmStatus?: string;
    parentConfirmNote?: string;
    reviewNote?: string;
    completionStatus?: string;
    timeline: LeaveTimeline[];
};

export const HomeSchoolPanel = ({ user }: { user: User }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const leaveSectionRef = useRef<HTMLElement | null>(null);
    const [messages, setMessages] = useState<MessageItem[]>([]);
    const [students, setStudents] = useState<StudentOption[]>([]);
    const [leaves, setLeaves] = useState<LeaveItem[]>([]);
    const [selectedLeaveIds, setSelectedLeaveIds] = useState<number[]>([]);
    const [error, setError] = useState("");
    const [form, setForm] = useState({ receiverRole: "parent", title: "", content: "" });
    const [leaveForm, setLeaveForm] = useState({
        studentId: 0,
        leaveType: "personal",
        reason: "",
        startAt: "",
        endAt: "",
        contactPhone: "",
        emergencyContact: ""
    });
    const [apiKey, setApiKey] = useState(storage.getApiKey());
    const [models, setModels] = useState<SupportedModel[]>([]);
    const [model, setModel] = useState("glm-4.7-flash");
    const [draftMap, setDraftMap] = useState<Record<number, string>>({});
    const [draftReasoningMap, setDraftReasoningMap] = useState<Record<number, string>>({});
    const [sending, setSending] = useState(false);
    const [readingMap, setReadingMap] = useState<Record<number, boolean>>({});
    const [draftingMap, setDraftingMap] = useState<Record<number, boolean>>({});
    const [reviewingMap, setReviewingMap] = useState<Record<number, boolean>>({});
    const [submittingLeave, setSubmittingLeave] = useState(false);

    const load = async () => {
        try {
            const [messageResp, leaveResp, studentResp, modelResp] = await Promise.all([
                apiRequest<MessageItem[]>("/api/home-school/messages"),
                apiRequest<LeaveItem[]>("/api/home-school/leave-requests"),
                apiRequest<StudentOption[]>("/api/students"),
                apiRequest<SupportedModel[]>("/api/ai/models")
            ]);
            setMessages(messageResp.data);
            setLeaves(leaveResp.data);
            setStudents(studentResp.data);
            const textModels = modelResp.data.filter((item) => item.supportsStreaming);
            setModels(textModels);
            setModel(textModels.find((item) => item.isDefault)?.id ?? textModels[0]?.id ?? "glm-4.7-flash");
            if (!leaveForm.studentId && studentResp.data.length > 0) {
                setLeaveForm((prev) => ({ ...prev, studentId: studentResp.data[0].id }));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载家校数据失败");
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const canBroadcast = user.role === "admin" || user.role === "teacher" || user.role === "head_teacher";
    const canApprove = user.role === "admin" || user.role === "head_teacher";
    const query = new URLSearchParams(location.search);
    const shouldFocusLeave = query.get("focus") === "leave";
    const shouldFilterPending = query.get("status") === "pending";

    const pendingCount = useMemo(
        () => leaves.filter((item) => ["pending_parent_confirm", "pending_head_teacher_review"].includes(item.status)).length,
        [leaves]
    );
    const visibleLeaves = useMemo(() => {
        if (!shouldFilterPending) {
            return leaves;
        }
        return leaves.filter((item) => ["pending_parent_confirm", "pending_head_teacher_review"].includes(item.status));
    }, [leaves, shouldFilterPending]);

    useEffect(() => {
        if (shouldFocusLeave && leaves.length >= 0) {
            window.setTimeout(() => leaveSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
        }
    }, [shouldFocusLeave, leaves.length]);

    const onSend = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setSending(true);
        try {
            await apiRequest("/api/home-school/messages", { method: "POST", body: JSON.stringify(form) });
            setForm({ receiverRole: "parent", title: "", content: "" });
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "发送失败");
        } finally {
            setSending(false);
        }
    };

    const submitLeave = async (event: FormEvent) => {
        event.preventDefault();
        setSubmittingLeave(true);
        setError("");
        try {
            await apiRequest("/api/home-school/leave-requests", {
                method: "POST",
                body: JSON.stringify(leaveForm)
            });
            setLeaveForm((prev) => ({ ...prev, reason: "", contactPhone: "", emergencyContact: "" }));
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "提交请假失败");
        } finally {
            setSubmittingLeave(false);
        }
    };

    const markRead = async (id: number) => {
        setReadingMap((prev) => ({ ...prev, [id]: true }));
        try {
            await apiRequest(`/api/home-school/messages/${id}/read`, { method: "PATCH" });
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "回执失败");
        } finally {
            setReadingMap((prev) => ({ ...prev, [id]: false }));
        }
    };

    const generateDraft = async (id: number) => {
        if (!apiKey.trim()) {
            setError("请先填写 API Key 才能生成 AI 回复草稿");
            return;
        }
        setDraftingMap((prev) => ({ ...prev, [id]: true }));
        try {
            storage.setApiKey(apiKey.trim());
            setDraftMap((prev) => ({ ...prev, [id]: "" }));
            setDraftReasoningMap((prev) => ({ ...prev, [id]: "" }));
            const response = await consumeSseStream(
                `/api/home-school/messages/${id}/ai-reply-draft-stream`,
                {
                    method: "POST",
                    body: JSON.stringify({ apiKey: apiKey.trim(), model }),
                    headers: { "Content-Type": "application/json" }
                },
                {
                    onTextDelta: (delta) => {
                        setDraftMap((prev) => ({ ...prev, [id]: `${prev[id] ?? ""}${delta}` }));
                    },
                    onReasoningDelta: (delta) => {
                        setDraftReasoningMap((prev) => ({ ...prev, [id]: `${prev[id] ?? ""}${delta}` }));
                    }
                }
            );
            setDraftMap((prev) => ({ ...prev, [id]: response.draft ?? prev[id] ?? "" }));
        } catch (err) {
            setError(err instanceof Error ? err.message : "生成草稿失败");
        } finally {
            setDraftingMap((prev) => ({ ...prev, [id]: false }));
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>家校沟通与请假管理</h3>
                <p>当前待处理请假 {pendingCount} 条。学生提交需家长确认，家长代提交可直接进入班主任审批，返校后仍需完成销假。</p>
            </article>

            {canBroadcast ? (
                <article className="panel-card wide">
                    <h4>发送通知</h4>
                    <form onSubmit={onSend} className="inline-form">
                        <label>
                            接收角色
                            <select value={form.receiverRole} onChange={(event) => setForm({ ...form, receiverRole: event.target.value })}>
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
                        <label className="wide-field">
                            内容
                            <textarea rows={3} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} required />
                        </label>
                        <button className="primary-btn" type="submit" disabled={sending}>{sending ? "发送中..." : "发送通知"}</button>
                    </form>
                </article>
            ) : null}

            {(user.role === "student" || user.role === "parent") ? (
                <article className="panel-card wide">
                    <h4>{user.role === "student" ? "学生请假申请" : "家长代提交请假"}</h4>
                    <form className="inline-form" onSubmit={submitLeave}>
                        <label>
                            学生
                            <select value={leaveForm.studentId} onChange={(event) => setLeaveForm((prev) => ({ ...prev, studentId: Number(event.target.value) }))}>
                                {students.map((item) => (
                                    <option key={item.id} value={item.id}>{item.name} / {item.className}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            请假类型
                            <select value={leaveForm.leaveType} onChange={(event) => setLeaveForm((prev) => ({ ...prev, leaveType: event.target.value }))}>
                                <option value="sick">病假</option>
                                <option value="personal">事假</option>
                                <option value="other">其他</option>
                            </select>
                        </label>
                        <label>
                            开始时间
                            <input type="datetime-local" value={leaveForm.startAt} onChange={(event) => setLeaveForm((prev) => ({ ...prev, startAt: event.target.value }))} required />
                        </label>
                        <label>
                            结束时间
                            <input type="datetime-local" value={leaveForm.endAt} onChange={(event) => setLeaveForm((prev) => ({ ...prev, endAt: event.target.value }))} required />
                        </label>
                        <label>
                            联系电话
                            <input value={leaveForm.contactPhone} onChange={(event) => setLeaveForm((prev) => ({ ...prev, contactPhone: event.target.value }))} required />
                        </label>
                        <label>
                            紧急联系人
                            <input value={leaveForm.emergencyContact} onChange={(event) => setLeaveForm((prev) => ({ ...prev, emergencyContact: event.target.value }))} required />
                        </label>
                        <label className="wide-field">
                            请假原因
                            <textarea rows={3} value={leaveForm.reason} onChange={(event) => setLeaveForm((prev) => ({ ...prev, reason: event.target.value }))} required />
                        </label>
                        <button className="primary-btn" type="submit" disabled={submittingLeave}>{submittingLeave ? "提交中..." : "提交请假申请"}</button>
                    </form>
                </article>
            ) : null}

            <article className="panel-card wide">
                <h4>最新通知</h4>
                <div className="inline-form section-actions">
                    <button className="secondary-btn" onClick={() => void downloadExport("/api/admin/export/module/messages", "messages")}>导出通知</button>
                    <button className="secondary-btn" onClick={() => navigate("/dashboard/ai-lab?scenario=home-school")}>进入 AI 助手</button>
                </div>
                <div className="list-box">
                    {messages.slice(0, 8).map((item) => (
                        <div key={item.id} className="list-item message-item">
                            <div className="list-item-header">
                                <strong>{item.title}</strong>
                                <span className={`status-pill ${item.isRead ? "is-read" : "is-unread"}`}>{item.isRead ? "已读" : "未读"}</span>
                            </div>
                            <p className="message-content">{item.content}</p>
                            <small className="list-item-meta">{item.senderName} · {new Date(item.createdAt).toLocaleString()}</small>
                            <div className="list-item-actions">
                                {!item.isRead ? (
                                    <button className="secondary-btn" onClick={() => void markRead(item.id)} disabled={Boolean(readingMap[item.id])}>
                                        {readingMap[item.id] ? "处理中..." : "标记已读"}
                                    </button>
                                ) : null}
                                {canBroadcast ? (
                                    <>
                                        <input value={apiKey} placeholder="API Key（生成回复草稿）" onChange={(event) => setApiKey(event.target.value)} />
                                        <select value={model} onChange={(event) => setModel(event.target.value)}>
                                            {models.map((item) => (
                                                <option key={item.id} value={item.id}>
                                                    {item.name} / {item.pricingTier === "paid" ? "收费" : "免费"}
                                                </option>
                                            ))}
                                        </select>
                                        <button className="secondary-btn" onClick={() => void generateDraft(item.id)} disabled={Boolean(draftingMap[item.id])}>
                                            {draftingMap[item.id] ? "生成中..." : "AI 生成回复草稿"}
                                        </button>
                                    </>
                                ) : null}
                            </div>
                            {draftMap[item.id] ? <p className="ai-draft">AI 草稿：{draftMap[item.id]}</p> : null}
                            {draftReasoningMap[item.id] ? (
                                <details className="reasoning-box" open={Boolean(draftingMap[item.id])}>
                                    <summary>思考过程</summary>
                                    <pre>{draftReasoningMap[item.id]}</pre>
                                </details>
                            ) : null}
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card wide" ref={leaveSectionRef}>
                <h4>请假进度</h4>
                <div className="inline-form section-actions">
                    {shouldFilterPending ? <span className="status-pill is-unread">仅显示待处理</span> : null}
                    <button className="secondary-btn" onClick={() => void downloadExport("/api/admin/export/module/leave-requests", "leave-requests")}>导出请假记录</button>
                    {canApprove ? (
                        <ConfirmActionButton
                            buttonText={`批量删除请假（${selectedLeaveIds.length}）`}
                            confirmTitle="确认批量删除请假"
                            confirmMessage={`确定删除选中的 ${selectedLeaveIds.length} 条请假记录吗？删除后将无法恢复。`}
                            disabled={selectedLeaveIds.length === 0}
                            onConfirm={async () => {
                                try {
                                    await apiRequest("/api/home-school/leave-requests/batch-delete", {
                                        method: "POST",
                                        body: JSON.stringify({ ids: selectedLeaveIds })
                                    });
                                    setSelectedLeaveIds([]);
                                    await load();
                                } catch (err) {
                                    setError(err instanceof Error ? err.message : "批量删除请假失败");
                                }
                            }}
                        />
                    ) : null}
                </div>

                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                {canApprove ? <th></th> : null}
                                <th>学生</th>
                                <th>类型</th>
                                <th>时间</th>
                                <th>状态</th>
                                <th>流程</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleLeaves.map((item) => (
                                <tr key={item.id} className={["pending_parent_confirm", "pending_head_teacher_review"].includes(item.status) ? "highlight-row" : ""}>
                                    {canApprove ? (
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={selectedLeaveIds.includes(item.id)}
                                                onChange={(event) => {
                                                    setSelectedLeaveIds((prev) => event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id));
                                                }}
                                            />
                                        </td>
                                    ) : null}
                                    <td>{item.studentName}<br /><small>{item.className}</small></td>
                                    <td>{leaveTypeLabelMap[item.leaveType] ?? item.leaveType}</td>
                                    <td>{item.startAt} - {item.endAt}</td>
                                    <td>
                                        <strong>{leaveStatusLabelMap[item.status] ?? mapLabel(item.status, leaveStatusLabelMap)}</strong>
                                        <br />
                                        <small>家长：{parentConfirmStatusLabelMap[item.parentConfirmStatus ?? "pending"] ?? mapLabel(item.parentConfirmStatus ?? "pending", parentConfirmStatusLabelMap)}</small>
                                    </td>
                                    <td>
                                        <div className="timeline-list">
                                            {item.timeline.map((timelineItem, index) => (
                                                <div key={`${item.id}-${index}`}>
                                                    <strong>{timelineItem.step}</strong>
                                                    <span>{timelineItem.status === "done" ? "已完成" : timelineItem.status === "pending" ? "进行中" : timelineItem.status === "returned" ? "已退回" : "待处理"}</span>
                                                    {timelineItem.note ? <small>{timelineItem.note}</small> : null}
                                                </div>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="btn-row">
                                        {user.role === "parent" && item.status === "pending_parent_confirm" ? (
                                            <>
                                                <button className="secondary-btn" onClick={async () => {
                                                    setReviewingMap((prev) => ({ ...prev, [item.id]: true }));
                                                    try {
                                                        await apiRequest(`/api/home-school/leave-requests/${item.id}/parent-confirm`, {
                                                            method: "PATCH",
                                                            body: JSON.stringify({ status: "confirmed", note: "家长已确认请假信息" })
                                                        });
                                                        await load();
                                                    } catch (err) {
                                                        setError(err instanceof Error ? err.message : "家长确认失败");
                                                    } finally {
                                                        setReviewingMap((prev) => ({ ...prev, [item.id]: false }));
                                                    }
                                                }} disabled={Boolean(reviewingMap[item.id])}>家长确认</button>
                                                <button className="secondary-btn" onClick={async () => {
                                                    try {
                                                        await apiRequest(`/api/home-school/leave-requests/${item.id}/parent-confirm`, {
                                                            method: "PATCH",
                                                            body: JSON.stringify({ status: "returned", note: "请补充请假说明后重新提交" })
                                                        });
                                                        await load();
                                                    } catch (err) {
                                                        setError(err instanceof Error ? err.message : "退回失败");
                                                    }
                                                }}>退回补充</button>
                                            </>
                                        ) : null}
                                        {canApprove && item.status === "pending_head_teacher_review" ? (
                                            <>
                                                <button className="secondary-btn" onClick={async () => {
                                                    try {
                                                        await apiRequest(`/api/home-school/leave-requests/${item.id}/review`, {
                                                            method: "PATCH",
                                                            body: JSON.stringify({ status: "approved", reviewNote: "批准请假，请按时返校销假" })
                                                        });
                                                        await load();
                                                    } catch (err) {
                                                        setError(err instanceof Error ? err.message : "审批失败");
                                                    }
                                                }}>批准</button>
                                                <button className="secondary-btn" onClick={async () => {
                                                    try {
                                                        await apiRequest(`/api/home-school/leave-requests/${item.id}/review`, {
                                                            method: "PATCH",
                                                            body: JSON.stringify({ status: "rejected", reviewNote: "请补充材料后重新提交" })
                                                        });
                                                        await load();
                                                    } catch (err) {
                                                        setError(err instanceof Error ? err.message : "驳回失败");
                                                    }
                                                }}>驳回</button>
                                            </>
                                        ) : null}
                                        {user.role === "student" && item.status === "pending_parent_confirm" ? (
                                            <button className="secondary-btn" onClick={async () => {
                                                try {
                                                    await apiRequest(`/api/home-school/leave-requests/${item.id}/cancel`, { method: "PATCH" });
                                                    await load();
                                                } catch (err) {
                                                    setError(err instanceof Error ? err.message : "撤回失败");
                                                }
                                            }}>撤回</button>
                                        ) : null}
                                        {user.role === "student" && item.status === "approved" ? (
                                            <button className="secondary-btn" onClick={async () => {
                                                try {
                                                    await apiRequest(`/api/home-school/leave-requests/${item.id}/complete`, {
                                                        method: "PATCH",
                                                        body: JSON.stringify({ completionNote: "学生已返校并向班主任销假" })
                                                    });
                                                    await load();
                                                } catch (err) {
                                                    setError(err instanceof Error ? err.message : "销假失败");
                                                }
                                            }}>返校销假</button>
                                        ) : null}
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
