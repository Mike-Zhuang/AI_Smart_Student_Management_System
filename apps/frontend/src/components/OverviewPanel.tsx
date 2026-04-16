import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { downloadExport } from "../lib/export";
import type { User } from "../lib/types";

type OverviewData = {
    users: Array<{ role: string; count: number }>;
    studentCount: number;
    messageCount: number;
};

export const OverviewPanel = ({ user }: { user: User }) => {
    const [overview, setOverview] = useState<OverviewData | null>(null);
    const [studentCount, setStudentCount] = useState(0);
    const [error, setError] = useState("");

    useEffect(() => {
        let mounted = true;

        const load = async () => {
            try {
                if (user.role === "admin") {
                    const response = await apiRequest<OverviewData>("/api/admin/system-overview");
                    if (mounted) {
                        setOverview(response.data);
                    }
                }

                const students = await apiRequest<Array<{ id: number }>>("/api/students");
                if (mounted) {
                    setStudentCount(students.data.length);
                }
            } catch (err) {
                if (mounted) {
                    setError(err instanceof Error ? err.message : "加载失败");
                }
            }
        };

        void load();
        return () => {
            mounted = false;
        };
    }, [user.role]);

    return (
        <section className="panel-grid">
            <article className="panel-card hero">
                <h3>项目总览</h3>
                <p>
                    这是面向中国大陆高中场景的一体化管理辅助系统，覆盖家校沟通、生涯规划选课、学生学业成长追踪与教师教研管理四大模块，
                    支持智谱模型接入与账号分级权限。
                </p>
                {user.role === "admin" ? (
                    <div className="inline-form">
                        <button
                            className="secondary-btn"
                            onClick={() => void downloadExport("/api/admin/audit-logs", "audit-logs")}
                        >
                            导出审计日志
                        </button>
                        <button
                            className="secondary-btn"
                            onClick={() => void downloadExport("/api/admin/export/evidence-report", "evaluation-evidence", "json")}
                        >
                            导出评比证据包
                        </button>
                    </div>
                ) : null}
            </article>

            <article className="panel-card">
                <h4>当前学生规模</h4>
                <strong className="metric">{studentCount}</strong>
            </article>

            <article className="panel-card">
                <h4>你的角色</h4>
                <strong className="metric">{user.role}</strong>
            </article>

            {overview ? (
                <article className="panel-card wide">
                    <h4>账号分布</h4>
                    <div className="role-grid">
                        {overview.users.map((item) => (
                            <div key={item.role} className="role-item">
                                <span>{item.role}</span>
                                <strong>{item.count}</strong>
                            </div>
                        ))}
                    </div>
                    <p>消息总量: {overview.messageCount}</p>
                </article>
            ) : null}

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
