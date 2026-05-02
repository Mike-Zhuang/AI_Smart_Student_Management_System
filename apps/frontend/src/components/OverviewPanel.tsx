import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { roleLabelMap } from "../lib/labels";
import type { User } from "../lib/types";

type OverviewData = {
    users: Array<{ role: string; count: number }>;
    studentCount: number;
    messageCount: number;
};

type LeaveOverview = Array<{ status: string }>;

type StudentOverview = Array<{ id: number; name: string; grade: string; className: string }>;

export const OverviewPanel = ({ user }: { user: User }) => {
    const navigate = useNavigate();
    const [overview, setOverview] = useState<OverviewData | null>(null);
    const [students, setStudents] = useState<StudentOverview>([]);
    const [leaveRequests, setLeaveRequests] = useState<LeaveOverview>([]);
    const [error, setError] = useState("");

    useEffect(() => {
        const load = async () => {
            try {
                const tasks: Array<Promise<unknown>> = [
                    apiRequest<StudentOverview>("/api/students"),
                    apiRequest<LeaveOverview>("/api/home-school/leave-requests")
                ];
                if (user.role === "admin") {
                    tasks.unshift(apiRequest<OverviewData>("/api/admin/system-overview"));
                }
                const result = await Promise.all(tasks);

                if (user.role === "admin") {
                    setOverview((result[0] as Awaited<ReturnType<typeof apiRequest<OverviewData>>>).data);
                    setStudents((result[1] as Awaited<ReturnType<typeof apiRequest<StudentOverview>>>).data);
                    setLeaveRequests((result[2] as Awaited<ReturnType<typeof apiRequest<LeaveOverview>>>).data);
                } else {
                    setStudents((result[0] as Awaited<ReturnType<typeof apiRequest<StudentOverview>>>).data);
                    setLeaveRequests((result[1] as Awaited<ReturnType<typeof apiRequest<LeaveOverview>>>).data);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "加载首页数据失败");
            }
        };

        void load();
    }, [user.role]);

    const leaveSummary = useMemo(() => {
        return leaveRequests.reduce(
            (acc, cur) => {
                acc.total += 1;
                if (["pending_parent_confirm", "pending_head_teacher_review"].includes(cur.status)) {
                    acc.pending += 1;
                }
                if (cur.status === "approved") {
                    acc.approved += 1;
                }
                return acc;
            },
            { total: 0, pending: 0, approved: 0 }
        );
    }, [leaveRequests]);

    const roleHomeTitleMap: Record<User["role"], string> = {
        admin: "全校运行首页",
        head_teacher: "班级治理首页",
        teacher: "任课教师首页",
        parent: "家庭协同首页",
        student: "个人成长首页"
    };

    return (
        <section className="panel-grid">
            <article className="panel-card hero">
                <h3>{roleHomeTitleMap[user.role]}</h3>
                <p>
                    当前身份为{roleLabelMap[user.role]}。系统会优先展示与你工作或学习直接相关的待办、学生情况、请假进度和最新提醒，
                    便于你快速进入日常工作节奏。
                </p>
            </article>

            <article className="panel-card">
                <h4>可见学生数</h4>
                <strong className="metric">{students.length}</strong>
            </article>

            <button type="button" className="panel-card action-card" onClick={() => navigate("/dashboard/home-school?focus=leave&status=pending")}>
                <h4>请假待处理</h4>
                <strong className="metric">{leaveSummary.pending}</strong>
                <p className="muted-text">当前可见请假共 {leaveSummary.total} 条</p>
            </button>

            <article className="panel-card">
                <h4>已批准请假</h4>
                <strong className="metric">{leaveSummary.approved}</strong>
                <p className="muted-text">返校后请及时提醒学生完成销假</p>
            </article>

            {user.role === "admin" && overview ? (
                <article className="panel-card wide">
                    <h4>全校运行概况</h4>
                    <div className="role-grid">
                        {overview.users.map((item) => (
                            <div key={item.role} className="role-item">
                                <span>{roleLabelMap[item.role as User["role"]] ?? "未知角色"}</span>
                                <strong>{item.count}</strong>
                            </div>
                        ))}
                    </div>
                    <p>全校学生总数：{overview.studentCount}</p>
                    <p>全站消息总量：{overview.messageCount}</p>
                </article>
            ) : null}

            <article className="panel-card wide">
                <h4>最近关注对象</h4>
                <div className="list-box compact">
                    {students.slice(0, 8).map((item) => (
                        <div key={item.id} className="list-item">
                            <strong>{item.name}</strong>
                            <p>{item.grade} · {item.className}</p>
                        </div>
                    ))}
                    {students.length === 0 ? <p className="muted-text">当前暂无可见学生数据。</p> : null}
                </div>
            </article>

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
