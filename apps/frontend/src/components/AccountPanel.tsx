import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../App";
import { apiRequest } from "../lib/api";
import { downloadPostFile } from "../lib/export";
import { roleLabelMap, selectionStatusLabelMap } from "../lib/labels";
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
    teacherClasses?: string | null;
    teacherSubjects?: string | null;
    parentStudents?: string | null;
    latestIssuanceItemId?: number | null;
    latestIssuanceBatchId?: number | null;
    latestIssuanceAt?: string | null;
    latestIssuanceTitle?: string | null;
    canDownloadPassword?: boolean | number | null;
};

type StudentOption = {
    id: number;
    studentNo: string;
    name: string;
    grade: string;
    className: string;
};

type IssuanceBatch = {
    id: number;
    batchType: string;
    sourceModule: string;
    title: string;
    note?: string | null;
    createdAt: string;
    operatorName?: string | null;
    totalCount: number;
    downloadableCount: number;
};

type IssuanceBatchItem = {
    id: number;
    userId: number;
    username: string;
    displayName: string;
    role: User["role"];
    relatedName?: string | null;
    studentNo?: string | null;
    className?: string | null;
    subjectName?: string | null;
    canDownloadPassword: boolean | number;
    invalidatedAt?: string | null;
    invalidationReason?: string | null;
    createdAt: string;
};

type IssuanceBatchDetail = {
    batch: IssuanceBatch;
    items: IssuanceBatchItem[];
};

const roleOrder: User["role"][] = ["student", "teacher", "head_teacher", "parent", "admin"];

export const AccountPanel = () => {
    const { user, setUser } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [data, setData] = useState<AccountInfo | null>(null);
    const [issuedAccounts, setIssuedAccounts] = useState<IssuedAccountRow[]>([]);
    const [batches, setBatches] = useState<IssuanceBatch[]>([]);
    const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
    const [selectedBatchDetail, setSelectedBatchDetail] = useState<IssuanceBatchDetail | null>(null);
    const [selectedAccountItemIds, setSelectedAccountItemIds] = useState<number[]>([]);
    const [selectedBatchItemIds, setSelectedBatchItemIds] = useState<number[]>([]);
    const [accountKeyword, setAccountKeyword] = useState("");
    const [roleFilter, setRoleFilter] = useState<"all" | User["role"]>("all");
    const [onlyPendingChange, setOnlyPendingChange] = useState(false);
    const [onlyDownloadable, setOnlyDownloadable] = useState(false);
    const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
    const [parentForm, setParentForm] = useState({
        studentId: 0,
        displayName: "",
        relation: "监护人",
        phone: "",
        username: ""
    });
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
    const [batchDownloading, setBatchDownloading] = useState(false);
    const [parentSubmitting, setParentSubmitting] = useState(false);
    const [batchGeneratingParents, setBatchGeneratingParents] = useState(false);
    const [resetDownloadInfo, setResetDownloadInfo] = useState<{
        batchId: number;
        batchTitle: string;
        username: string;
    } | null>(null);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const canManageIssuedAccounts = ["admin", "teacher", "head_teacher"].includes(data?.user.role ?? user?.role ?? "");
    const loginUrl = `${window.location.origin}/login`;

    const loadBaseData = async () => {
        const response = await apiRequest<AccountInfo>("/api/auth/me");
        setData(response.data);
        setProfileForm({
            displayName: response.data.user.displayName,
            phone: response.data.user.phone ?? "",
            email: response.data.user.email ?? ""
        });

        if (["admin", "teacher", "head_teacher"].includes(user?.role ?? response.data.user.role)) {
            const [issuedResponse, batchResponse, studentsResponse] = await Promise.all([
                apiRequest<IssuedAccountRow[]>("/api/auth/accounts"),
                apiRequest<IssuanceBatch[]>("/api/auth/account-issuance-batches"),
                apiRequest<StudentOption[]>("/api/students")
            ]);
            setIssuedAccounts(issuedResponse.data);
            setBatches(batchResponse.data);
            setStudentOptions(studentsResponse.data);
            setParentForm((prev) => ({
                ...prev,
                studentId: prev.studentId || studentsResponse.data[0]?.id || 0
            }));

            const routeBatchId = Number(searchParams.get("batchId") ?? "");
            const nextBatchId = Number.isNaN(routeBatchId) || routeBatchId <= 0
                ? batchResponse.data[0]?.id ?? null
                : routeBatchId;
            setSelectedBatchId(nextBatchId);
        } else {
            setIssuedAccounts([]);
            setBatches([]);
            setStudentOptions([]);
            setSelectedBatchId(null);
        }
    };

    const loadBatchDetail = async (batchId: number) => {
        const response = await apiRequest<IssuanceBatchDetail>(`/api/auth/account-issuance-batches/${batchId}`);
        setSelectedBatchDetail(response.data);
    };

    const load = async () => {
        try {
            setError("");
            await loadBaseData();
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载账号信息失败");
        }
    };

    useEffect(() => {
        void load();
    }, []);

    useEffect(() => {
        if (!selectedBatchId || !canManageIssuedAccounts) {
            setSelectedBatchDetail(null);
            return;
        }

        void loadBatchDetail(selectedBatchId);
    }, [selectedBatchId, canManageIssuedAccounts]);

    useEffect(() => {
        const routeBatchId = Number(searchParams.get("batchId") ?? "");
        if (!Number.isNaN(routeBatchId) && routeBatchId > 0 && routeBatchId !== selectedBatchId) {
            setSelectedBatchId(routeBatchId);
        }
    }, [searchParams, selectedBatchId]);

    useEffect(() => {
        setSelectedBatchItemIds([]);
    }, [selectedBatchId]);

    const filteredAccounts = useMemo(() => {
        const keyword = accountKeyword.trim().toLowerCase();
        return issuedAccounts
            .filter((item) => {
                if (roleFilter !== "all" && item.role !== roleFilter) {
                    return false;
                }
                if (onlyPendingChange && !item.mustChangePassword) {
                    return false;
                }
                if (onlyDownloadable && !Boolean(item.canDownloadPassword)) {
                    return false;
                }
                if (!keyword) {
                    return true;
                }
                return [
                    item.username,
                    item.displayName,
                    item.studentName,
                    item.studentNo,
                    item.className,
                    item.teacherClasses,
                    item.teacherSubjects,
                    item.parentStudents
                ].some((value) => String(value ?? "").toLowerCase().includes(keyword));
            })
            .sort((left, right) => {
                const leftRole = roleOrder.indexOf(left.role);
                const rightRole = roleOrder.indexOf(right.role);
                return leftRole - rightRole || right.id - left.id;
            });
    }, [accountKeyword, issuedAccounts, onlyDownloadable, onlyPendingChange, roleFilter]);

    const selectedBatchDownloadableItems = useMemo(() => {
        return (selectedBatchDetail?.items ?? []).filter((item) => Boolean(item.canDownloadPassword));
    }, [selectedBatchDetail]);

    const roleLabel = useMemo(() => {
        return data?.user.role ? roleLabelMap[data.user.role] : "--";
    }, [data?.user.role]);

    const relationText = (item: IssuedAccountRow): string => {
        if (item.studentName) {
            return `${item.studentName} / ${item.studentNo ?? "--"} / ${item.className ?? "--"}`;
        }
        if (item.teacherClasses) {
            return `${item.teacherClasses}${item.teacherSubjects ? ` / ${item.teacherSubjects}` : ""}`;
        }
        if (item.parentStudents) {
            return item.parentStudents;
        }
        return item.className ?? "--";
    };

    const downloadSelectedAccountPasswords = async () => {
        if (selectedAccountItemIds.length === 0) {
            return;
        }

        try {
            setBatchDownloading(true);
            const result = await downloadPostFile(
                "/api/auth/account-issuance-items/download",
                { itemIds: selectedAccountItemIds },
                `选中未改密账号-${new Date().toISOString().slice(0, 10)}.xlsx`
            );
            setSuccess(result.skippedCount > 0 ? `下载完成，已自动跳过 ${result.skippedCount} 个已改密账号。` : "下载完成。");
        } catch (err) {
            setError(err instanceof Error ? err.message : "下载账号密码失败");
        } finally {
            setBatchDownloading(false);
        }
    };

    const downloadSelectedBatchItems = async () => {
        if (selectedBatchItemIds.length === 0) {
            return;
        }

        try {
            setBatchDownloading(true);
            const result = await downloadPostFile(
                "/api/auth/account-issuance-items/download",
                { itemIds: selectedBatchItemIds },
                `${selectedBatchDetail?.batch.title ?? "账号发放批次"}.xlsx`
            );
            setSuccess(result.skippedCount > 0 ? `下载完成，已跳过 ${result.skippedCount} 个已改密账号。` : "下载完成。");
        } catch (err) {
            setError(err instanceof Error ? err.message : "下载批次账号密码失败");
        } finally {
            setBatchDownloading(false);
        }
    };

    const downloadWholeBatch = async (batchId: number, title: string) => {
        try {
            setBatchDownloading(true);
            const result = await downloadPostFile(
                `/api/auth/account-issuance-batches/${batchId}/download`,
                {},
                `${title}.xlsx`
            );
            setSuccess(result.skippedCount > 0 ? `批次下载完成，已跳过 ${result.skippedCount} 个已改密账号。` : "批次下载完成。");
        } catch (err) {
            setError(err instanceof Error ? err.message : "下载批次账号失败");
        } finally {
            setBatchDownloading(false);
        }
    };

    const createParentAccount = async (event: FormEvent) => {
        event.preventDefault();
        if (!parentForm.studentId) {
            setError("请先选择学生");
            return;
        }

        setParentSubmitting(true);
        setError("");
        setSuccess("");
        try {
            const response = await apiRequest<{ issuanceBatchId: number | null; username: string }>(
                "/api/auth/parent-accounts",
                {
                    method: "POST",
                    body: JSON.stringify({
                        studentId: parentForm.studentId,
                        displayName: parentForm.displayName.trim(),
                        relation: parentForm.relation.trim(),
                        phone: parentForm.phone.trim(),
                        username: parentForm.username.trim()
                    })
                }
            );
            setSuccess(`家长账号 ${response.data.username} 已创建并加入发放批次。`);
            setParentForm((prev) => ({
                ...prev,
                displayName: "",
                relation: "监护人",
                phone: "",
                username: ""
            }));
            if (response.data.issuanceBatchId) {
                setResetDownloadInfo({
                    batchId: response.data.issuanceBatchId,
                    batchTitle: `家长账号发放`,
                    username: response.data.username
                });
            }
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : "创建家长账号失败");
        } finally {
            setParentSubmitting(false);
        }
    };

    const batchGenerateParents = async () => {
        setBatchGeneratingParents(true);
        setError("");
        setSuccess("");
        try {
            const response = await apiRequest<{ count: number; issuanceBatchIds: number[] }>("/api/auth/parent-accounts/batch-generate", {
                method: "POST",
                body: JSON.stringify({})
            });
            setSuccess(response.message);
            await load();
            const latestBatchId =
                response.data.issuanceBatchIds.length > 0
                    ? response.data.issuanceBatchIds[response.data.issuanceBatchIds.length - 1]
                    : undefined;
            if (latestBatchId) {
                setSelectedBatchId(latestBatchId);
                setSearchParams({ batchId: String(latestBatchId) });
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "补齐主家长账号失败");
        } finally {
            setBatchGeneratingParents(false);
        }
    };

    const onSaveProfile = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setSuccess("");
        setLoading(true);

        try {
            const response = await apiRequest<{ token: string; user: User }>("/api/auth/me/profile", {
                method: "PATCH",
                body: JSON.stringify({
                    displayName: profileForm.displayName.trim(),
                    phone: profileForm.phone.trim(),
                    email: profileForm.email.trim()
                })
            });

            storage.setToken(response.data.token);
            setUser(response.data.user);
            setSuccess("个人资料已更新。");
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
            setSuccess("密码修改成功。系统已自动失效你名下可再次下载的历史一次性密码。");
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
                <p>角色：{roleLabel}</p>
                <p>登录账号：{data?.user.username ?? "--"}</p>
                <p>登录入口：{loginUrl}</p>
                <p>首次登录提示：如当前使用的是系统发放的一次性密码，请先进入“修改密码”完成改密。</p>
                <p>创建时间：{data ? new Date(data.user.createdAt).toLocaleString() : "--"}</p>
                {data?.user.mustChangePassword ? <p className="warning-box">当前账号仍在使用系统发放的一次性密码，请先修改密码后再继续使用。</p> : null}
            </article>

            <article className="panel-card">
                <h4>基础资料</h4>
                <form className="form-stack" onSubmit={onSaveProfile}>
                    <label>
                        显示名
                        <input value={profileForm.displayName} onChange={(event) => setProfileForm((prev) => ({ ...prev, displayName: event.target.value }))} required />
                    </label>
                    <label>
                        手机号
                        <input value={profileForm.phone} onChange={(event) => setProfileForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="选填" />
                    </label>
                    <label>
                        邮箱
                        <input value={profileForm.email} onChange={(event) => setProfileForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="选填" />
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
                        <input type="password" value={passwordForm.oldPassword} onChange={(event) => setPasswordForm((prev) => ({ ...prev, oldPassword: event.target.value }))} required />
                    </label>
                    <label>
                        新密码
                        <input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))} minLength={8} required />
                    </label>
                    <label>
                        确认新密码
                        <input type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))} minLength={8} required />
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
                            <strong>{selectionStatusLabelMap[data.roleProfile.student.selectionStatus] ?? "待完善"}</strong>
                        </div>
                    </div>
                    <p>当前组合：{data.roleProfile.student.subjectCombination ?? "暂无"}</p>
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

            {canManageIssuedAccounts ? (
                <>
                    <article className="panel-card wide">
                        <h4>家长账号管理</h4>
                        <p>系统会在学生导入时自动生成主家长账号。若还有未补齐的学生，可一键补齐；也可以为同一学生追加第 2、第 3 个家长账号。</p>
                        <div className="account-actions section-actions">
                            <button
                                type="button"
                                className="secondary-btn"
                                disabled={batchGeneratingParents}
                                onClick={() => void batchGenerateParents()}
                            >
                                {batchGeneratingParents ? "补齐中..." : "一键补齐缺失主家长账号"}
                            </button>
                        </div>
                        <form className="inline-form section-actions" onSubmit={createParentAccount}>
                            <label>
                                绑定学生
                                <select value={parentForm.studentId} onChange={(event) => setParentForm((prev) => ({ ...prev, studentId: Number(event.target.value) }))}>
                                    {studentOptions.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.name} / {item.studentNo} / {item.className}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                家长姓名
                                <input value={parentForm.displayName} onChange={(event) => setParentForm((prev) => ({ ...prev, displayName: event.target.value }))} required />
                            </label>
                            <label>
                                关系
                                <input value={parentForm.relation} onChange={(event) => setParentForm((prev) => ({ ...prev, relation: event.target.value }))} placeholder="如：父亲、母亲、监护人" required />
                            </label>
                            <label>
                                手机号
                                <input value={parentForm.phone} onChange={(event) => setParentForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="选填" />
                            </label>
                            <label>
                                登录账号
                                <input value={parentForm.username} onChange={(event) => setParentForm((prev) => ({ ...prev, username: event.target.value }))} placeholder="选填，不填则自动生成" />
                            </label>
                            <button className="primary-btn" type="submit" disabled={parentSubmitting || studentOptions.length === 0}>
                                {parentSubmitting ? "创建中..." : "追加家长账号"}
                            </button>
                        </form>
                    </article>

                    <article className="panel-card wide">
                        <h4>账号发放台账</h4>
                        <p>说明：登录账号就是登录页输入框里要填写的用户名；一次性密码只在“用户尚未改密”期间可再次下载。一旦用户自行改密，历史原密码会自动失效。</p>
                        <p className="muted-text">如需再次发放密码，可直接“重置密码”，系统会自动生成新的发放批次。</p>

                        <div className="inline-form section-actions">
                            <label>
                                搜索账号/姓名/班级
                                <input value={accountKeyword} onChange={(event) => setAccountKeyword(event.target.value)} placeholder="输入账号、姓名、班级、学科" />
                            </label>
                            <label>
                                身份
                                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | User["role"])}>
                                    <option value="all">全部</option>
                                    <option value="student">学生</option>
                                    <option value="teacher">教师</option>
                                    <option value="head_teacher">班主任</option>
                                    <option value="parent">家长</option>
                                    <option value="admin">管理员</option>
                                </select>
                            </label>
                            <label className="toggle-label">
                                <input type="checkbox" checked={onlyPendingChange} onChange={(event) => setOnlyPendingChange(event.target.checked)} />
                                只看待改密账号
                            </label>
                            <label className="toggle-label">
                                <input type="checkbox" checked={onlyDownloadable} onChange={(event) => setOnlyDownloadable(event.target.checked)} />
                                只看仍可再次下载
                            </label>
                            <button className="primary-btn" type="button" disabled={selectedAccountItemIds.length === 0 || batchDownloading} onClick={() => void downloadSelectedAccountPasswords()}>
                                {batchDownloading ? "下载中..." : `下载选中账号密码（${selectedAccountItemIds.length}）`}
                            </button>
                        </div>

                        <div className="table-scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th></th>
                                        <th>登录账号</th>
                                        <th>姓名</th>
                                        <th>身份</th>
                                        <th>关联信息</th>
                                        <th>当前状态</th>
                                        <th>仍可再次下载</th>
                                        <th>最近发放</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredAccounts.map((item) => (
                                        <tr key={item.id}>
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    disabled={!Boolean(item.canDownloadPassword) || !item.latestIssuanceItemId}
                                                    checked={item.latestIssuanceItemId ? selectedAccountItemIds.includes(item.latestIssuanceItemId) : false}
                                                    onChange={(event) => {
                                                        if (!item.latestIssuanceItemId) {
                                                            return;
                                                        }
                                                        setSelectedAccountItemIds((prev) =>
                                                            event.target.checked
                                                                ? [...prev, item.latestIssuanceItemId!]
                                                                : prev.filter((targetId) => targetId !== item.latestIssuanceItemId)
                                                        );
                                                    }}
                                                />
                                            </td>
                                            <td>{item.username}</td>
                                            <td>{item.displayName}</td>
                                            <td>{roleLabelMap[item.role]}</td>
                                            <td>{relationText(item)}</td>
                                            <td>{item.mustChangePassword ? "待修改初始密码" : "已完成改密"}</td>
                                            <td>{item.canDownloadPassword ? "是" : "否"}</td>
                                            <td>{item.latestIssuanceAt ? new Date(item.latestIssuanceAt).toLocaleString() : "--"}</td>
                                            <td>
                                                <div className="account-actions">
                                                    {item.latestIssuanceBatchId ? (
                                                        <button
                                                            type="button"
                                                            className="secondary-btn"
                                                            onClick={() => {
                                                                setSelectedBatchId(item.latestIssuanceBatchId ?? null);
                                                                if (item.latestIssuanceBatchId) {
                                                                    setSearchParams({ batchId: String(item.latestIssuanceBatchId) });
                                                                }
                                                            }}
                                                        >
                                                            查看批次
                                                        </button>
                                                    ) : null}
                                                    <button
                                                        type="button"
                                                        className="secondary-btn"
                                                        onClick={async () => {
                                                            try {
                                                                setError("");
                                                                setSuccess("");
                                                                const response = await apiRequest<{ issuanceBatchId: number | null; username: string; batchTitle?: string }>(
                                                                    `/api/auth/accounts/${item.id}/reset-password`,
                                                                    { method: "POST" }
                                                                );
                                                                setSuccess(`已为账号 ${response.data.username} 生成新的重置批次。`);
                                                                await load();
                                                                if (response.data.issuanceBatchId) {
                                                                    setResetDownloadInfo({
                                                                        batchId: response.data.issuanceBatchId,
                                                                        batchTitle: response.data.batchTitle ?? `账号 ${response.data.username} 重置密码`,
                                                                        username: response.data.username
                                                                    });
                                                                    setSelectedBatchId(response.data.issuanceBatchId);
                                                                    setSearchParams({ batchId: String(response.data.issuanceBatchId) });
                                                                }
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
                                    {filteredAccounts.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="muted-text">当前筛选条件下暂无账号记录。</td>
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </div>
                    </article>

                    <article className="panel-card wide">
                        <h4>账号发放批次记录</h4>
                        <p className="muted-text">学生导入、教师导入和人工重置密码都会生成批次记录。你可以按整批下载，也可以查看明细后只下载仍未改密的部分账号。</p>
                        <div className="table-scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th>批次标题</th>
                                        <th>时间</th>
                                        <th>发起人</th>
                                        <th>总账号数</th>
                                        <th>仍可下载数</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {batches.map((item) => (
                                        <tr key={item.id}>
                                            <td>{item.title}</td>
                                            <td>{new Date(item.createdAt).toLocaleString()}</td>
                                            <td>{item.operatorName ?? "--"}</td>
                                            <td>{item.totalCount}</td>
                                            <td>{item.downloadableCount}</td>
                                            <td>
                                                <div className="account-actions">
                                                    <button
                                                        type="button"
                                                        className="secondary-btn"
                                                        onClick={() => {
                                                            setSelectedBatchId(item.id);
                                                            setSearchParams({ batchId: String(item.id) });
                                                        }}
                                                    >
                                                        查看明细
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="secondary-btn"
                                                        disabled={item.downloadableCount === 0 || batchDownloading}
                                                        onClick={() => void downloadWholeBatch(item.id, item.title)}
                                                    >
                                                        下载本批未改密账号
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {batches.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="muted-text">当前暂无账号发放批次记录。</td>
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </div>
                    </article>

                    {selectedBatchDetail ? (
                        <article className="panel-card wide">
                            <h4>批次明细：{selectedBatchDetail.batch.title}</h4>
                            <p>
                                发起时间：{new Date(selectedBatchDetail.batch.createdAt).toLocaleString()} · 发起人：{selectedBatchDetail.batch.operatorName ?? "--"} ·
                                仍可下载：{selectedBatchDetail.batch.downloadableCount} / {selectedBatchDetail.batch.totalCount}
                            </p>
                            <div className="inline-form section-actions">
                                <button
                                    type="button"
                                    className="primary-btn"
                                    disabled={selectedBatchItemIds.length === 0 || batchDownloading}
                                    onClick={() => void downloadSelectedBatchItems()}
                                >
                                    {batchDownloading ? "下载中..." : `下载勾选账号（${selectedBatchItemIds.length}）`}
                                </button>
                                <button
                                    type="button"
                                    className="secondary-btn"
                                    disabled={selectedBatchDownloadableItems.length === 0 || batchDownloading}
                                    onClick={() => {
                                        setSelectedBatchItemIds(selectedBatchDownloadableItems.map((item) => item.id));
                                    }}
                                >
                                    勾选全部未改密账号
                                </button>
                            </div>
                            <div className="table-scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th></th>
                                            <th>登录账号</th>
                                            <th>姓名</th>
                                            <th>身份</th>
                                            <th>关联信息</th>
                                            <th>是否仍可下载</th>
                                            <th>失效时间</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedBatchDetail.items.map((item) => (
                                            <tr key={item.id}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        disabled={!Boolean(item.canDownloadPassword)}
                                                        checked={selectedBatchItemIds.includes(item.id)}
                                                        onChange={(event) => {
                                                            setSelectedBatchItemIds((prev) =>
                                                                event.target.checked ? [...prev, item.id] : prev.filter((targetId) => targetId !== item.id)
                                                            );
                                                        }}
                                                    />
                                                </td>
                                                <td>{item.username}</td>
                                                <td>{item.displayName}</td>
                                                <td>{roleLabelMap[item.role]}</td>
                                                <td>{item.relatedName ?? "--"}</td>
                                                <td>{item.canDownloadPassword ? "是" : "否（已改密）"}</td>
                                                <td>{item.invalidatedAt ? new Date(item.invalidatedAt).toLocaleString() : "--"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </article>
                    ) : null}
                </>
            ) : null}

            {error ? <p className="error-text">{error}</p> : null}
            {success ? <p className="success-text">{success}</p> : null}
            {resetDownloadInfo ? (
                <div className="confirm-modal-backdrop" role="presentation">
                    <div className="confirm-modal">
                        <h4>新密码已生成</h4>
                        <p>账号 {resetDownloadInfo.username} 的一次性新密码已经进入发放批次。你现在就可以直接下载，不需要再滚动到页面下方寻找。</p>
                        <div className="account-actions">
                            <button type="button" className="secondary-btn" onClick={() => setResetDownloadInfo(null)}>
                                稍后处理
                            </button>
                            <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => {
                                    setSelectedBatchId(resetDownloadInfo.batchId);
                                    setSearchParams({ batchId: String(resetDownloadInfo.batchId) });
                                    setResetDownloadInfo(null);
                                }}
                            >
                                查看批次明细
                            </button>
                            <button
                                type="button"
                                className="primary-btn"
                                onClick={async () => {
                                    await downloadWholeBatch(resetDownloadInfo.batchId, resetDownloadInfo.batchTitle);
                                    setSelectedBatchId(resetDownloadInfo.batchId);
                                    setSearchParams({ batchId: String(resetDownloadInfo.batchId) });
                                    setResetDownloadInfo(null);
                                }}
                            >
                                立即下载新密码
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
};
