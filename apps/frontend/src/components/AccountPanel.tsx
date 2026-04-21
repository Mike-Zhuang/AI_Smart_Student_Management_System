import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../App";
import { apiRequest } from "../lib/api";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";

type AccountInfo = {
    user: User & {
        phone?: string | null;
        email?: string | null;
        isActive?: boolean;
        passwordResetAt?: string | null;
        createdAt: string;
    };
    roleProfile: {
        student?: {
            id: number;
            studentNo: string;
            name: string;
            grade: string;
            className: string;
            academicStage: string;
            selectionStatus: string;
            firstSelectedSubject: string | null;
            secondSelectedSubject: string | null;
            thirdSelectedSubject: string | null;
            subjectCombination: string | null;
        };
        linkedStudents?: Array<{
            id: number;
            studentNo: string;
            name: string;
            grade: string;
            className: string;
            relation: string;
        }>;
        classes?: Array<{
            className: string;
            subjectName: string | null;
            isHeadTeacher: number;
        }>;
    };
};

type IssuedAccountRow = {
    id: number;
    username: string;
    displayName: string;
    role: User["role"];
    linkedStudentId: number | null;
    mustChangePassword: boolean;
    passwordResetAt: string | null;
    isActive: boolean;
    createdAt: string;
    studentNo?: string | null;
    studentName?: string | null;
    className?: string | null;
};

export const AccountPanel = () => {
    const { user, setUser } = useAuth();
    const [data, setData] = useState<AccountInfo | null>(null);
    const [issuedAccounts, setIssuedAccounts] = useState<IssuedAccountRow[]>([]);
    const [resetFeedback, setResetFeedback] = useState("");
    const [profileForm, setProfileForm] = useState({
        displayName: "",
        phone: "",
        email: ""
    });
    const [passwordForm, setPasswordForm] = useState({
        oldPassword: "",
        newPassword: "",
        confirmPassword: ""
    });
    const [loading, setLoading] = useState(false);
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const load = async () => {
        try {
            const response = await apiRequest<AccountInfo>("/api/auth/me");
            setData(response.data);
            if (["admin", "teacher", "head_teacher"].includes(user?.role ?? response.data.user.role)) {
                const issuedResponse = await apiRequest<IssuedAccountRow[]>("/api/auth/accounts");
                setIssuedAccounts(issuedResponse.data);
            } else {
                setIssuedAccounts([]);
            }
            setProfileForm({
                displayName: response.data.user.displayName,
                phone: response.data.user.phone ?? "",
                email: response.data.user.email ?? ""
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载账号信息失败");
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const roleLabel = useMemo(() => {
        const role = data?.user.role;
        const map: Record<string, string> = {
            admin: "管理员",
            teacher: "教师",
            head_teacher: "班主任",
            parent: "家长",
            student: "学生"
        };

        return role ? map[role] ?? role : "--";
    }, [data?.user.role]);

    const onSaveProfile = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setSuccess("");
        setLoading(true);

        const payload = {
            displayName: profileForm.displayName.trim(),
            phone: profileForm.phone.trim(),
            email: profileForm.email.trim()
        };

        try {
            const response = await apiRequest<{ token: string; user: User; profile: { phone?: string | null; email?: string | null } }>(
                "/api/auth/me/profile",
                {
                    method: "PATCH",
                    body: JSON.stringify(payload)
                }
            );

            storage.setToken(response.data.token);
            setUser(response.data.user);
            setSuccess("个人资料已更新");
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "更新资料失败");
        } finally {
            setLoading(false);
        }
    };

    const onChangePassword = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setSuccess("");

        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            setError("两次输入的新密码不一致");
            return;
        }

        setPasswordLoading(true);
        try {
            const response = await apiRequest<{ token: string; user: User }>("/api/auth/me/password", {
                method: "PATCH",
                body: JSON.stringify({
                    oldPassword: passwordForm.oldPassword,
                    newPassword: passwordForm.newPassword
                })
            });

            storage.setToken(response.data.token);
            setUser(response.data.user);
            setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
            setSuccess("密码修改成功");
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "密码修改失败");
        } finally {
            setPasswordLoading(false);
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>我的账号</h3>
                <p>角色: {roleLabel}</p>
                <p>用户名: {data?.user.username ?? "--"}</p>
                <p>创建时间: {data ? new Date(data.user.createdAt).toLocaleString() : "--"}</p>
                {data?.user.mustChangePassword ? <p className="warning-box">当前账号为系统发放的初始密码，建议立即修改密码后再继续使用。</p> : null}
            </article>

            <article className="panel-card">
                <h4>基础资料</h4>
                <form className="form-stack" onSubmit={onSaveProfile}>
                    <label>
                        显示名
                        <input
                            value={profileForm.displayName}
                            onChange={(event) =>
                                setProfileForm((prev) => ({
                                    ...prev,
                                    displayName: event.target.value
                                }))
                            }
                            required
                        />
                    </label>
                    <label>
                        手机号
                        <input
                            value={profileForm.phone}
                            onChange={(event) =>
                                setProfileForm((prev) => ({
                                    ...prev,
                                    phone: event.target.value
                                }))
                            }
                            placeholder="选填"
                        />
                    </label>
                    <label>
                        邮箱
                        <input
                            value={profileForm.email}
                            onChange={(event) =>
                                setProfileForm((prev) => ({
                                    ...prev,
                                    email: event.target.value
                                }))
                            }
                            placeholder="选填"
                        />
                    </label>
                    <button className="primary-btn" type="submit" disabled={loading}>
                        {loading ? "保存中..." : "保存资料"}
                    </button>
                </form>
            </article>

            <article className="panel-card">
                <h4>修改密码</h4>
                <form className="form-stack" onSubmit={onChangePassword}>
                    <label>
                        旧密码
                        <input
                            type="password"
                            value={passwordForm.oldPassword}
                            onChange={(event) =>
                                setPasswordForm((prev) => ({
                                    ...prev,
                                    oldPassword: event.target.value
                                }))
                            }
                            required
                        />
                    </label>
                    <label>
                        新密码
                        <input
                            type="password"
                            value={passwordForm.newPassword}
                            onChange={(event) =>
                                setPasswordForm((prev) => ({
                                    ...prev,
                                    newPassword: event.target.value
                                }))
                            }
                            minLength={8}
                            required
                        />
                    </label>
                    <label>
                        确认新密码
                        <input
                            type="password"
                            value={passwordForm.confirmPassword}
                            onChange={(event) =>
                                setPasswordForm((prev) => ({
                                    ...prev,
                                    confirmPassword: event.target.value
                                }))
                            }
                            minLength={8}
                            required
                        />
                    </label>
                    <button className="secondary-btn" type="submit" disabled={passwordLoading}>
                        {passwordLoading ? "修改中..." : "修改密码"}
                    </button>
                </form>
            </article>

            {data?.roleProfile.student ? (
                <article className="panel-card wide">
                    <h4>学生档案</h4>
                    <div className="role-grid">
                        <div className="role-item">
                            <span>学号</span>
                            <strong>{data.roleProfile.student.studentNo}</strong>
                        </div>
                        <div className="role-item">
                            <span>班级</span>
                            <strong>{data.roleProfile.student.grade} / {data.roleProfile.student.className}</strong>
                        </div>
                        <div className="role-item">
                            <span>学段</span>
                            <strong>{data.roleProfile.student.academicStage}</strong>
                        </div>
                        <div className="role-item">
                            <span>选科状态</span>
                            <strong>{data.roleProfile.student.selectionStatus}</strong>
                        </div>
                    </div>
                    <p>当前组合: {data.roleProfile.student.subjectCombination ?? "暂无"}</p>
                </article>
            ) : null}

            {data?.roleProfile.linkedStudents && data.roleProfile.linkedStudents.length > 0 ? (
                <article className="panel-card wide">
                    <h4>已绑定学生</h4>
                    <div className="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    <th>学号</th>
                                    <th>姓名</th>
                                    <th>年级班级</th>
                                    <th>关系</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.roleProfile.linkedStudents.map((item) => (
                                    <tr key={item.id}>
                                        <td>{item.studentNo}</td>
                                        <td>{item.name}</td>
                                        <td>{item.grade} / {item.className}</td>
                                        <td>{item.relation}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </article>
            ) : null}

            {data?.roleProfile.classes && data.roleProfile.classes.length > 0 ? (
                <article className="panel-card wide">
                    <h4>任教班级</h4>
                    <div className="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    <th>班级</th>
                                    <th>任教学科</th>
                                    <th>班主任标记</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.roleProfile.classes.map((item) => (
                                    <tr key={`${item.className}-${item.subjectName ?? ""}`}>
                                        <td>{item.className}</td>
                                        <td>{item.subjectName ?? "待完善"}</td>
                                        <td>{item.isHeadTeacher ? "是" : "否"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </article>
            ) : null}

            {["admin", "teacher", "head_teacher"].includes(data?.user.role ?? "") ? (
                <article className="panel-card wide">
                    <h4>账号发放台账</h4>
                    <p className="muted-text">支持查看最近账号、重置一次性密码并重新发放。</p>
                    {resetFeedback ? <p className="success-text">{resetFeedback}</p> : null}
                    <div className="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    <th>账号</th>
                                    <th>姓名</th>
                                    <th>角色</th>
                                    <th>关联信息</th>
                                    <th>状态</th>
                                    <th>最近重置</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {issuedAccounts.map((item) => (
                                    <tr key={item.id}>
                                        <td>{item.username}</td>
                                        <td>{item.displayName}</td>
                                        <td>{item.role}</td>
                                        <td>{item.studentName ? `${item.studentName} / ${item.studentNo} / ${item.className ?? "--"}` : item.className ?? "--"}</td>
                                        <td>{item.mustChangePassword ? "待改密" : "正常"}</td>
                                        <td>{item.passwordResetAt ? new Date(item.passwordResetAt).toLocaleString() : "--"}</td>
                                        <td>
                                            <div className="account-actions">
                                                <button
                                                    type="button"
                                                    className="secondary-btn"
                                                    onClick={async () => {
                                                        try {
                                                            setError("");
                                                            setSuccess("");
                                                            setResetFeedback("");
                                                            const response = await apiRequest<{
                                                                username: string;
                                                                temporaryPassword: string;
                                                            }>(`/api/auth/accounts/${item.id}/reset-password`, {
                                                                method: "POST"
                                                            });
                                                            setResetFeedback(
                                                                `账号 ${response.data.username} 的一次性密码已重置为：${response.data.temporaryPassword}`
                                                            );
                                                            await load();
                                                        } catch (err) {
                                                            setError(err instanceof Error ? err.message : "重置密码失败");
                                                        }
                                                    }}
                                                >
                                                    重置密码
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </article>
            ) : null}

            {error ? <p className="error-text">{error}</p> : null}
            {success ? <p className="success-text">{success}</p> : null}
        </section>
    );
};
