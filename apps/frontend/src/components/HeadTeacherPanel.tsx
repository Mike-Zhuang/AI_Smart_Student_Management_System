import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import { createGrid, parseStructuredCommittee, parseStructuredGrid, randomizeSeatGrid, serializeStructuredCommittee, serializeStructuredGrid, updateGridCell, type StructuredCommitteeMember, type StructuredCommitteeValue, type StructuredGridValue } from "../lib/classProfile";
import { riskLevelLabelMap } from "../lib/labels";
import { ConfirmActionButton } from "./ConfirmActionButton";

type WorkbenchData = {
    className: string;
    availableClasses: string[];
    todoFunnel: Array<{ stage: string; count: number }>;
    riskStudents: Array<{
        id: number;
        name: string;
        className: string;
        riskLevel: "high" | "medium" | "low";
        summary: string;
        avgScore: number;
    }>;
    scoreBoard: Array<{ groupName: string; totalScore: number }>;
    recentActions: Array<{
        id: number;
        actionModule: string;
        actionType: string;
        objectType: string;
        createdAt: string;
        operatorName: string;
    }>;
};

type ClassProfileData = {
    profile: {
        className: string;
        classMotto: string;
        classStyle: string;
        classSlogan: string;
        courseSchedule: string;
        classRules: string;
        seatMap: string;
        classCommittee: string;
    } | null;
    roster: Array<{ id: number; studentNo: string; name: string; grade: string; className: string }>;
};

type ClassLog = {
    id: number;
    className: string;
    studentId?: number | null;
    studentName?: string;
    category: string;
    title: string;
    content: string;
    recordDate: string;
    createdAt: string;
};

type WellbeingPost = { id: number; className: string; title: string; content: string; attachmentName?: string | null; createdAt: string };
type GroupScoreResponse = { records: Array<{ id: number; groupName: string; activityName: string; scoreDelta: number; note: string; createdAt: string }>; scoreBoard: Array<{ groupName: string; totalScore: number }> };
type GalleryItem = { id: number; className: string; title: string; description: string; activityDate?: string | null; fileName?: string | null; createdAt: string };

export const HeadTeacherPanel = () => {
    const [className, setClassName] = useState("");
    const [workbench, setWorkbench] = useState<WorkbenchData | null>(null);
    const [profileData, setProfileData] = useState<ClassProfileData | null>(null);
    const [logs, setLogs] = useState<ClassLog[]>([]);
    const [selectedLogIds, setSelectedLogIds] = useState<number[]>([]);
    const [wellbeingPosts, setWellbeingPosts] = useState<WellbeingPost[]>([]);
    const [groupScores, setGroupScores] = useState<GroupScoreResponse | null>(null);
    const [gallery, setGallery] = useState<GalleryItem[]>([]);
    const [wellbeingFile, setWellbeingFile] = useState<File | null>(null);
    const [galleryFile, setGalleryFile] = useState<File | null>(null);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [profileForm, setProfileForm] = useState({
        classMotto: "",
        classStyle: "",
        classSlogan: "",
        classRules: ""
    });
    const [courseScheduleMode, setCourseScheduleMode] = useState<"grid" | "text">("grid");
    const [courseScheduleGrid, setCourseScheduleGrid] = useState<StructuredGridValue>(createGrid(5, 7));
    const [courseScheduleText, setCourseScheduleText] = useState("");
    const [seatMapMode, setSeatMapMode] = useState<"grid" | "text">("grid");
    const [seatMapGrid, setSeatMapGrid] = useState<StructuredGridValue>(createGrid(6, 6));
    const [seatMapText, setSeatMapText] = useState("");
    const [committeeMode, setCommitteeMode] = useState<"committee" | "text">("committee");
    const [committeeValue, setCommitteeValue] = useState<StructuredCommitteeValue>({ kind: "committee", members: [] });
    const [committeeText, setCommitteeText] = useState("");
    const [logForm, setLogForm] = useState({ studentName: "", category: "班级日常", title: "", content: "", recordDate: new Date().toISOString().slice(0, 10) });
    const [wellbeingForm, setWellbeingForm] = useState({ title: "", content: "" });
    const [groupForm, setGroupForm] = useState({ groupName: "", activityName: "", scoreDelta: 1, note: "" });
    const [galleryForm, setGalleryForm] = useState({ title: "", description: "", activityDate: new Date().toISOString().slice(0, 10) });

    const load = async (targetClass?: string) => {
        try {
            const queryClass = targetClass ?? className;
            const query = queryClass ? `?className=${encodeURIComponent(queryClass)}` : "";
            const workbenchResp = await apiRequest<WorkbenchData>(`/api/head-teacher/workbench${query}`);
            const resolvedClassName = workbenchResp.data.className;
            setWorkbench(workbenchResp.data);
            setClassName(resolvedClassName);

            const [profileResp, logResp, wellbeingResp, scoreResp, galleryResp] = await Promise.all([
                apiRequest<ClassProfileData>(`/api/head-teacher/class-profile?className=${encodeURIComponent(resolvedClassName)}`),
                apiRequest<ClassLog[]>(`/api/head-teacher/class-logs?className=${encodeURIComponent(resolvedClassName)}`),
                apiRequest<WellbeingPost[]>(`/api/head-teacher/wellbeing-posts?className=${encodeURIComponent(resolvedClassName)}`),
                apiRequest<GroupScoreResponse>(`/api/head-teacher/group-score-records?className=${encodeURIComponent(resolvedClassName)}`),
                apiRequest<GalleryItem[]>(`/api/head-teacher/gallery?className=${encodeURIComponent(resolvedClassName)}`)
            ]);

            setProfileData(profileResp.data);
            setLogs(logResp.data);
            setWellbeingPosts(wellbeingResp.data);
            setGroupScores(scoreResp.data);
            setGallery(galleryResp.data);
            if (profileResp.data.profile) {
                const parsedCourseSchedule = parseStructuredGrid(profileResp.data.profile.courseSchedule ?? "");
                const parsedSeatMap = parseStructuredGrid(profileResp.data.profile.seatMap ?? "");
                const parsedCommittee = parseStructuredCommittee(profileResp.data.profile.classCommittee ?? "");
                setProfileForm({
                    classMotto: profileResp.data.profile.classMotto ?? "",
                    classStyle: profileResp.data.profile.classStyle ?? "",
                    classSlogan: profileResp.data.profile.classSlogan ?? "",
                    classRules: profileResp.data.profile.classRules ?? ""
                });
                setCourseScheduleMode(parsedCourseSchedule.mode);
                setCourseScheduleGrid(parsedCourseSchedule.mode === "grid" ? parsedCourseSchedule.value : createGrid(5, 7));
                setCourseScheduleText(parsedCourseSchedule.mode === "text" ? parsedCourseSchedule.value : "");
                setSeatMapMode(parsedSeatMap.mode);
                setSeatMapGrid(parsedSeatMap.mode === "grid" ? parsedSeatMap.value : createGrid(6, 6));
                setSeatMapText(parsedSeatMap.mode === "text" ? parsedSeatMap.value : "");
                setCommitteeMode(parsedCommittee.mode);
                setCommitteeValue(parsedCommittee.mode === "committee" ? parsedCommittee.value : { kind: "committee", members: [] });
                setCommitteeText(parsedCommittee.mode === "text" ? parsedCommittee.value : "");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载班级治理数据失败");
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const riskSummary = useMemo(() => {
        return (workbench?.riskStudents ?? []).reduce(
            (acc, cur) => {
                if (cur.riskLevel === "high") acc.high += 1;
                if (cur.riskLevel === "medium") acc.medium += 1;
                return acc;
            },
            { high: 0, medium: 0 }
        );
    }, [workbench?.riskStudents]);

    const onSaveProfile = async (event: FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        try {
            await apiRequest("/api/head-teacher/class-profile", {
                method: "PATCH",
                body: JSON.stringify({
                    className,
                    ...profileForm,
                    courseSchedule: serializeStructuredGrid(courseScheduleMode, courseScheduleGrid, courseScheduleText),
                    seatMap: serializeStructuredGrid(seatMapMode, seatMapGrid, seatMapText),
                    classCommittee: serializeStructuredCommittee(committeeMode, committeeValue, committeeText)
                })
            });
            await load(className);
        } catch (err) {
            setError(err instanceof Error ? err.message : "保存班级简介失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>班级治理中心</h3>
                <div className="inline-form">
                    <label>
                        班级
                        <select value={className} onChange={(event) => setClassName(event.target.value)}>
                            {(workbench?.availableClasses ?? []).map((item) => (
                                <option key={item} value={item}>{item}</option>
                            ))}
                        </select>
                    </label>
                    <button className="primary-btn" onClick={() => void load(className)}>刷新班级数据</button>
                </div>
            </article>

            <article className="panel-card">
                <h4>当前待办</h4>
                <div className="funnel-list">
                    {workbench?.todoFunnel.map((item) => (
                        <div className="funnel-item" key={item.stage}>
                            <span>{item.stage}</span>
                            <strong>{item.count}</strong>
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card">
                <h4>重点关注学生</h4>
                <p>高风险 {riskSummary.high} 人 · 中风险 {riskSummary.medium} 人</p>
                <div className="list-box compact">
                    {(workbench?.riskStudents ?? []).slice(0, 4).map((item) => (
                        <div className="list-item" key={item.id}>
                            <strong>{item.name}</strong>
                            <p>{riskLevelLabelMap[item.riskLevel]} · 均分 {item.avgScore}</p>
                            <small>{item.summary}</small>
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card">
                <h4>小组评比榜</h4>
                <div className="list-box compact">
                    {(groupScores?.scoreBoard ?? []).map((item) => (
                        <div className="list-item" key={item.groupName}>
                            <strong>{item.groupName}</strong>
                            <p>累计积分：{item.totalScore}</p>
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card wide">
                <h4>成长记录 / 班级日志</h4>
                <form className="inline-form" onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                        await apiRequest("/api/head-teacher/class-logs", {
                            method: "POST",
                            body: JSON.stringify({ className, ...logForm })
                        });
                        setLogForm({ studentName: "", category: "班级日常", title: "", content: "", recordDate: new Date().toISOString().slice(0, 10) });
                        await load(className);
                    } catch (err) {
                        setError(err instanceof Error ? err.message : "新增班级日志失败");
                    }
                }}>
                    <label>
                        学生姓名
                        <input value={logForm.studentName} onChange={(event) => setLogForm((prev) => ({ ...prev, studentName: event.target.value }))} placeholder="可选" />
                    </label>
                    <label>
                        分类
                        <input value={logForm.category} onChange={(event) => setLogForm((prev) => ({ ...prev, category: event.target.value }))} />
                    </label>
                    <label>
                        标题
                        <input value={logForm.title} onChange={(event) => setLogForm((prev) => ({ ...prev, title: event.target.value }))} required />
                    </label>
                    <label>
                        日期
                        <input type="date" value={logForm.recordDate} onChange={(event) => setLogForm((prev) => ({ ...prev, recordDate: event.target.value }))} required />
                    </label>
                    <label className="wide-field">
                        内容
                        <textarea rows={3} value={logForm.content} onChange={(event) => setLogForm((prev) => ({ ...prev, content: event.target.value }))} required />
                    </label>
                    <button className="primary-btn" type="submit">新增日志</button>
                    <ConfirmActionButton
                        buttonText={`批量删除日志（${selectedLogIds.length}）`}
                        confirmTitle="确认批量删除班级日志"
                        confirmMessage={`确定删除选中的 ${selectedLogIds.length} 条班级日志吗？删除后将无法恢复。`}
                        disabled={selectedLogIds.length === 0}
                        onConfirm={async () => {
                            await apiRequest("/api/head-teacher/class-logs/batch-delete", {
                                method: "POST",
                                body: JSON.stringify({ ids: selectedLogIds })
                            });
                            setSelectedLogIds([]);
                            await load(className);
                        }}
                    />
                </form>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th>日期</th>
                                <th>分类</th>
                                <th>标题</th>
                                <th>学生</th>
                                <th>内容</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map((item) => (
                                <tr key={item.id}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedLogIds.includes(item.id)}
                                            onChange={(event) => {
                                                setSelectedLogIds((prev) => event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id));
                                            }}
                                        />
                                    </td>
                                    <td>{item.recordDate}</td>
                                    <td>{item.category}</td>
                                    <td>{item.title}</td>
                                    <td>{item.studentName || "--"}</td>
                                    <td>{item.content}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </article>

            <article className="panel-card wide">
                <h4>心灵驿站</h4>
                <form className="inline-form" onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                        const formData = new FormData();
                        formData.append("className", className);
                        formData.append("title", wellbeingForm.title);
                        formData.append("content", wellbeingForm.content);
                        if (wellbeingFile) {
                            formData.append("file", wellbeingFile);
                        }
                        await apiRequest("/api/head-teacher/wellbeing-posts", { method: "POST", body: formData });
                        setWellbeingForm({ title: "", content: "" });
                        setWellbeingFile(null);
                        await load(className);
                    } catch (err) {
                        setError(err instanceof Error ? err.message : "发布心灵驿站失败");
                    }
                }}>
                    <label>
                        标题
                        <input value={wellbeingForm.title} onChange={(event) => setWellbeingForm((prev) => ({ ...prev, title: event.target.value }))} required />
                    </label>
                    <label className="wide-field">
                        正文
                        <textarea rows={3} value={wellbeingForm.content} onChange={(event) => setWellbeingForm((prev) => ({ ...prev, content: event.target.value }))} required />
                    </label>
                    <label>
                        附件（可选）
                        <input type="file" onChange={(event) => setWellbeingFile(event.target.files?.[0] ?? null)} />
                    </label>
                    <button className="primary-btn" type="submit">发布内容</button>
                </form>
                <div className="list-box compact">
                    {wellbeingPosts.map((item) => (
                        <div className="list-item" key={item.id}>
                            <strong>{item.title}</strong>
                            <p>{item.content}</p>
                            <div className="list-item-actions">
                                {item.attachmentName ? <small>附件：{item.attachmentName}</small> : null}
                                <small>{new Date(item.createdAt).toLocaleString()}</small>
                                <ConfirmActionButton
                                    buttonText="删除"
                                    confirmTitle="确认删除心灵驿站内容"
                                    confirmMessage={`确定删除《${item.title}》吗？`}
                                    onConfirm={async () => {
                                        await apiRequest(`/api/head-teacher/wellbeing-posts/${item.id}`, { method: "DELETE" });
                                        await load(className);
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card wide">
                <h4>小组评比</h4>
                <form className="inline-form" onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                        await apiRequest("/api/head-teacher/group-score-records", {
                            method: "POST",
                            body: JSON.stringify({ className, ...groupForm, scoreDelta: Number(groupForm.scoreDelta) })
                        });
                        setGroupForm({ groupName: "", activityName: "", scoreDelta: 1, note: "" });
                        await load(className);
                    } catch (err) {
                        setError(err instanceof Error ? err.message : "新增积分记录失败");
                    }
                }}>
                    <label>
                        小组名称
                        <input value={groupForm.groupName} onChange={(event) => setGroupForm((prev) => ({ ...prev, groupName: event.target.value }))} required />
                    </label>
                    <label>
                        活动项目
                        <input value={groupForm.activityName} onChange={(event) => setGroupForm((prev) => ({ ...prev, activityName: event.target.value }))} required />
                    </label>
                    <label>
                        积分变化
                        <input type="number" value={groupForm.scoreDelta} onChange={(event) => setGroupForm((prev) => ({ ...prev, scoreDelta: Number(event.target.value) }))} required />
                    </label>
                    <label className="wide-field">
                        备注
                        <input value={groupForm.note} onChange={(event) => setGroupForm((prev) => ({ ...prev, note: event.target.value }))} />
                    </label>
                    <button className="primary-btn" type="submit">记录积分</button>
                </form>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>小组</th>
                                <th>活动</th>
                                <th>积分</th>
                                <th>备注</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(groupScores?.records ?? []).map((item) => (
                                <tr key={item.id}>
                                    <td>{item.groupName}</td>
                                    <td>{item.activityName}</td>
                                    <td>{item.scoreDelta}</td>
                                    <td>{item.note}</td>
                                    <td>
                                        <ConfirmActionButton
                                            buttonText="删除"
                                            confirmTitle="确认删除积分记录"
                                            confirmMessage={`确定删除“小组 ${item.groupName} / ${item.activityName}”这条积分记录吗？`}
                                            onConfirm={async () => {
                                                await apiRequest(`/api/head-teacher/group-score-records/${item.id}`, { method: "DELETE" });
                                                await load(className);
                                            }}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </article>

            <article className="panel-card wide">
                <h4>班级风采</h4>
                <form className="inline-form" onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                        const formData = new FormData();
                        formData.append("className", className);
                        formData.append("title", galleryForm.title);
                        formData.append("description", galleryForm.description);
                        formData.append("activityDate", galleryForm.activityDate);
                        if (galleryFile) {
                            formData.append("file", galleryFile);
                        }
                        await apiRequest("/api/head-teacher/gallery", { method: "POST", body: formData });
                        setGalleryForm({ title: "", description: "", activityDate: new Date().toISOString().slice(0, 10) });
                        setGalleryFile(null);
                        await load(className);
                    } catch (err) {
                        setError(err instanceof Error ? err.message : "新增班级风采失败");
                    }
                }}>
                    <label>
                        标题
                        <input value={galleryForm.title} onChange={(event) => setGalleryForm((prev) => ({ ...prev, title: event.target.value }))} required />
                    </label>
                    <label>
                        活动日期
                        <input type="date" value={galleryForm.activityDate} onChange={(event) => setGalleryForm((prev) => ({ ...prev, activityDate: event.target.value }))} />
                    </label>
                    <label className="wide-field">
                        说明
                        <textarea rows={3} value={galleryForm.description} onChange={(event) => setGalleryForm((prev) => ({ ...prev, description: event.target.value }))} />
                    </label>
                    <label>
                        照片或附件（可选）
                        <input type="file" accept="image/*,.pdf,.doc,.docx" onChange={(event) => setGalleryFile(event.target.files?.[0] ?? null)} />
                    </label>
                    <button className="primary-btn" type="submit">新增风采</button>
                </form>
                <div className="list-box compact">
                    {gallery.map((item) => (
                        <div className="list-item" key={item.id}>
                            <strong>{item.title}</strong>
                            <p>{item.description || "暂无说明"}</p>
                            <div className="list-item-actions">
                                {item.fileName ? <small>文件：{item.fileName}</small> : null}
                                <small>{item.activityDate || "--"}</small>
                                <ConfirmActionButton
                                    buttonText="删除"
                                    confirmTitle="确认删除班级风采"
                                    confirmMessage={`确定删除《${item.title}》这条班级风采吗？`}
                                    onConfirm={async () => {
                                        await apiRequest(`/api/head-teacher/gallery/${item.id}`, { method: "DELETE" });
                                        await load(className);
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </article>

            <article className="panel-card wide">
                <h4>班级简介</h4>
                <form className="form-stack" onSubmit={onSaveProfile}>
                    <div className="inline-form">
                        <label>
                            班风
                            <input value={profileForm.classStyle} onChange={(event) => setProfileForm((prev) => ({ ...prev, classStyle: event.target.value }))} />
                        </label>
                        <label>
                            班训
                            <input value={profileForm.classMotto} onChange={(event) => setProfileForm((prev) => ({ ...prev, classMotto: event.target.value }))} />
                        </label>
                        <label>
                            口号
                            <input value={profileForm.classSlogan} onChange={(event) => setProfileForm((prev) => ({ ...prev, classSlogan: event.target.value }))} />
                        </label>
                    </div>
                    <label>
                        课程表
                        {courseScheduleMode === "grid" ? (
                            <div className="structured-editor">
                                <div className="account-actions">
                                    <label>
                                        行数
                                        <input type="number" min={1} max={20} value={courseScheduleGrid.rows} onChange={(event) => setCourseScheduleGrid(createGrid(Number(event.target.value), courseScheduleGrid.cols, courseScheduleGrid.cells))} />
                                    </label>
                                    <label>
                                        列数
                                        <input type="number" min={1} max={20} value={courseScheduleGrid.cols} onChange={(event) => setCourseScheduleGrid(createGrid(courseScheduleGrid.rows, Number(event.target.value), courseScheduleGrid.cells))} />
                                    </label>
                                    <button type="button" className="secondary-btn" onClick={() => setCourseScheduleGrid(createGrid(courseScheduleGrid.rows, courseScheduleGrid.cols))}>
                                        重新生成表格
                                    </button>
                                    <button type="button" className="secondary-btn" onClick={() => setCourseScheduleMode("text")}>
                                        切换为纯文本
                                    </button>
                                </div>
                                <div className="table-scroll">
                                    <table>
                                        <tbody>
                                            {courseScheduleGrid.cells.map((row, rowIndex) => (
                                                <tr key={`course-edit-${rowIndex}`}>
                                                    {row.map((cell, colIndex) => (
                                                        <td key={`course-edit-${rowIndex}-${colIndex}`}>
                                                            <input
                                                                value={cell}
                                                                onChange={(event) => setCourseScheduleGrid(updateGridCell(courseScheduleGrid, rowIndex, colIndex, event.target.value))}
                                                            />
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <>
                                <textarea rows={4} value={courseScheduleText} onChange={(event) => setCourseScheduleText(event.target.value)} />
                                <button type="button" className="secondary-btn" onClick={() => setCourseScheduleMode("grid")}>
                                    切换为表格编辑
                                </button>
                            </>
                        )}
                    </label>
                    <label>
                        班级公约
                        <textarea rows={3} value={profileForm.classRules} onChange={(event) => setProfileForm((prev) => ({ ...prev, classRules: event.target.value }))} />
                    </label>
                    <label>
                        座位表
                        {seatMapMode === "grid" ? (
                            <div className="structured-editor">
                                <div className="account-actions">
                                    <label>
                                        行数
                                        <input type="number" min={1} max={20} value={seatMapGrid.rows} onChange={(event) => setSeatMapGrid(createGrid(Number(event.target.value), seatMapGrid.cols, seatMapGrid.cells))} />
                                    </label>
                                    <label>
                                        列数
                                        <input type="number" min={1} max={20} value={seatMapGrid.cols} onChange={(event) => setSeatMapGrid(createGrid(seatMapGrid.rows, Number(event.target.value), seatMapGrid.cells))} />
                                    </label>
                                    <button type="button" className="secondary-btn" onClick={() => setSeatMapGrid(createGrid(seatMapGrid.rows, seatMapGrid.cols))}>
                                        重新生成表格
                                    </button>
                                    <button
                                        type="button"
                                        className="secondary-btn"
                                        onClick={() => setSeatMapGrid(randomizeSeatGrid(seatMapGrid, (profileData?.roster ?? []).map((item) => item.name)))}
                                    >
                                        随机排座
                                    </button>
                                    <button type="button" className="secondary-btn" onClick={() => setSeatMapMode("text")}>
                                        切换为纯文本
                                    </button>
                                </div>
                                <div className="table-scroll">
                                    <table>
                                        <tbody>
                                            {seatMapGrid.cells.map((row, rowIndex) => (
                                                <tr key={`seat-edit-${rowIndex}`}>
                                                    {row.map((cell, colIndex) => (
                                                        <td key={`seat-edit-${rowIndex}-${colIndex}`}>
                                                            <input
                                                                value={cell}
                                                                onChange={(event) => setSeatMapGrid(updateGridCell(seatMapGrid, rowIndex, colIndex, event.target.value))}
                                                            />
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <>
                                <textarea rows={4} value={seatMapText} onChange={(event) => setSeatMapText(event.target.value)} />
                                <button type="button" className="secondary-btn" onClick={() => setSeatMapMode("grid")}>
                                    切换为表格编辑
                                </button>
                            </>
                        )}
                    </label>
                    <label>
                        班委会
                        {committeeMode === "committee" ? (
                            <div className="structured-editor">
                                <div className="account-actions">
                                    <button
                                        type="button"
                                        className="secondary-btn"
                                        onClick={() =>
                                            setCommitteeValue((prev) => ({
                                                kind: "committee",
                                                members: [...prev.members, { position: "", name: "" } satisfies StructuredCommitteeMember]
                                            }))
                                        }
                                    >
                                        新增班委
                                    </button>
                                    <button type="button" className="secondary-btn" onClick={() => setCommitteeMode("text")}>
                                        切换为纯文本
                                    </button>
                                </div>
                                <div className="table-scroll">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>职务</th>
                                                <th>姓名</th>
                                                <th>操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {committeeValue.members.map((item, index) => (
                                                <tr key={`committee-${index}`}>
                                                    <td>
                                                        <input
                                                            value={item.position}
                                                            onChange={(event) =>
                                                                setCommitteeValue((prev) => ({
                                                                    kind: "committee",
                                                                    members: prev.members.map((member, memberIndex) =>
                                                                        memberIndex === index ? { ...member, position: event.target.value } : member
                                                                    )
                                                                }))
                                                            }
                                                        />
                                                    </td>
                                                    <td>
                                                        <input
                                                            value={item.name}
                                                            onChange={(event) =>
                                                                setCommitteeValue((prev) => ({
                                                                    kind: "committee",
                                                                    members: prev.members.map((member, memberIndex) =>
                                                                        memberIndex === index ? { ...member, name: event.target.value } : member
                                                                    )
                                                                }))
                                                            }
                                                        />
                                                    </td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="secondary-btn"
                                                            onClick={() =>
                                                                setCommitteeValue((prev) => ({
                                                                    kind: "committee",
                                                                    members: prev.members.filter((_, memberIndex) => memberIndex !== index)
                                                                }))
                                                            }
                                                        >
                                                            删除
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {committeeValue.members.length === 0 ? (
                                                <tr>
                                                    <td colSpan={3} className="muted-text">当前未添加班委成员。</td>
                                                </tr>
                                            ) : null}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <>
                                <textarea rows={4} value={committeeText} onChange={(event) => setCommitteeText(event.target.value)} />
                                <button type="button" className="secondary-btn" onClick={() => setCommitteeMode("committee")}>
                                    切换为结构化班委表
                                </button>
                            </>
                        )}
                    </label>
                    <button className="primary-btn" type="submit" disabled={saving}>{saving ? "保存中..." : "保存班级简介"}</button>
                </form>

                <h5>班级花名册</h5>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>学号</th>
                                <th>姓名</th>
                                <th>年级</th>
                                <th>班级</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(profileData?.roster ?? []).map((item) => (
                                <tr key={item.id}>
                                    <td>{item.studentNo}</td>
                                    <td>{item.name}</td>
                                    <td>{item.grade}</td>
                                    <td>{item.className}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </article>

            <article className="panel-card wide">
                <h4>最近操作轨迹</h4>
                <div className="list-box compact">
                    {(workbench?.recentActions ?? []).map((item) => (
                        <div className="list-item" key={item.id}>
                            <strong>{item.actionModule}</strong>
                            <p>{item.operatorName} 执行了 {item.actionType}</p>
                            <small>{new Date(item.createdAt).toLocaleString()}</small>
                        </div>
                    ))}
                </div>
            </article>

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
