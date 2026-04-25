import { useEffect, useMemo, useState } from "react";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { apiRequest } from "../lib/api";
import { parseStructuredCommittee, parseStructuredGrid } from "../lib/classProfile";

type ClassSpaceOverview = {
    availableClasses: Array<{
        className: string;
        label: string;
    }>;
    defaultClassName: string;
};

type ClassSpaceDetail = {
    className: string;
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
    wellbeingPosts: Array<{ id: number; title: string; content: string; attachmentName?: string | null; attachmentKind?: "image" | "file" | null; attachmentUrl?: string | null; createdAt: string }>;
    gallery: Array<{ id: number; title: string; description: string; activityDate?: string | null; fileName?: string | null; fileKind?: "image" | "file" | null; fileUrl?: string | null; createdAt: string }>;
};

export const ClassSpacePanel = () => {
    const [overview, setOverview] = useState<ClassSpaceOverview | null>(null);
    const [detail, setDetail] = useState<ClassSpaceDetail | null>(null);
    const [selectedClassName, setSelectedClassName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const loadOverview = async () => {
        const response = await apiRequest<ClassSpaceOverview>("/api/class-space/overview");
        setOverview(response.data);
        if (!selectedClassName) {
            setSelectedClassName(response.data.defaultClassName);
        }
        return response.data;
    };

    const loadDetail = async (className: string) => {
        if (!className) {
            setDetail(null);
            return;
        }
        const response = await apiRequest<ClassSpaceDetail>(`/api/class-space/detail?className=${encodeURIComponent(className)}`);
        setDetail(response.data);
    };

    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true);
                setError("");
                const nextOverview = await loadOverview();
                await loadDetail(selectedClassName || nextOverview.defaultClassName);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "加载班级空间失败");
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, []);

    useEffect(() => {
        if (!selectedClassName) {
            return;
        }
        void loadDetail(selectedClassName);
    }, [selectedClassName]);

    const courseSchedule = useMemo(() => parseStructuredGrid(detail?.profile?.courseSchedule), [detail?.profile?.courseSchedule]);
    const seatMap = useMemo(() => parseStructuredGrid(detail?.profile?.seatMap), [detail?.profile?.seatMap]);
    const committee = useMemo(() => parseStructuredCommittee(detail?.profile?.classCommittee), [detail?.profile?.classCommittee]);

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>班级空间</h3>
                <p>这里汇总班级简介、花名册、课程表、座位表、班级风采和心灵驿站，方便学生、家长和老师查看班级公共信息。</p>
                <div className="inline-form section-actions">
                    <label>
                        查看班级
                        <select value={selectedClassName} onChange={(event) => setSelectedClassName(event.target.value)}>
                            {(overview?.availableClasses ?? []).map((item) => (
                                <option key={item.className} value={item.className}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button type="button" className="secondary-btn" onClick={() => void loadDetail(selectedClassName)} disabled={loading}>
                        {loading ? "刷新中..." : "刷新班级空间"}
                    </button>
                </div>
            </article>

            {detail?.profile ? (
                <>
                    <article className="panel-card">
                        <h4>班风</h4>
                        <p>{detail.profile.classStyle || "待完善"}</p>
                    </article>
                    <article className="panel-card">
                        <h4>班训 / 口号</h4>
                        <p>{detail.profile.classMotto || "待完善"}</p>
                        <p className="muted-text">{detail.profile.classSlogan || "待完善"}</p>
                    </article>
                    <article className="panel-card wide">
                        <h4>班级公约</h4>
                        <p>{detail.profile.classRules || "待完善"}</p>
                    </article>
                </>
            ) : null}

            <article className="panel-card wide">
                <h4>课程表</h4>
                {courseSchedule.mode === "grid" ? (
                    <div className="table-scroll">
                        <table>
                            <tbody>
                                {courseSchedule.value.cells.map((row, rowIndex) => (
                                    <tr key={`course-${rowIndex}`}>
                                        {row.map((cell, colIndex) => (
                                            <td key={`course-${rowIndex}-${colIndex}`}>{cell || "—"}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p>{courseSchedule.value || "待完善"}</p>
                )}
            </article>

            <article className="panel-card wide">
                <h4>座位表</h4>
                {seatMap.mode === "grid" ? (
                    <div className="table-scroll">
                        <table>
                            <tbody>
                                {seatMap.value.cells.map((row, rowIndex) => (
                                    <tr key={`seat-${rowIndex}`}>
                                        {row.map((cell, colIndex) => (
                                            <td key={`seat-${rowIndex}-${colIndex}`}>{cell || "空位"}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p>{seatMap.value || "待完善"}</p>
                )}
            </article>

            <article className="panel-card wide">
                <h4>班委会</h4>
                {committee.mode === "committee" ? (
                    <div className="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    <th>职务</th>
                                    <th>姓名</th>
                                </tr>
                            </thead>
                            <tbody>
                                {committee.value.members.map((item, index) => (
                                    <tr key={`${item.position}-${item.name}-${index}`}>
                                        <td>{item.position || "待补充"}</td>
                                        <td>{item.name || "待补充"}</td>
                                    </tr>
                                ))}
                                {committee.value.members.length === 0 ? (
                                    <tr>
                                        <td colSpan={2} className="muted-text">当前未填写班委会信息。</td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p>{committee.value || "待完善"}</p>
                )}
            </article>

            <article className="panel-card wide">
                <h4>班级花名册</h4>
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
                            {(detail?.roster ?? []).map((item) => (
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
                <h4>心灵驿站</h4>
                <div className="list-box compact">
                    {(detail?.wellbeingPosts ?? []).map((item) => (
                        <div className="list-item" key={item.id}>
                            <strong>{item.title}</strong>
                            <p>{item.content}</p>
                            {item.attachmentKind === "image" && item.attachmentUrl ? (
                                <AuthenticatedImage className="class-space-media" srcPath={item.attachmentUrl} alt={item.attachmentName || item.title} />
                            ) : null}
                            <small>{item.attachmentName ? `附件：${item.attachmentName} · ` : ""}{new Date(item.createdAt).toLocaleString()}</small>
                        </div>
                    ))}
                    {(detail?.wellbeingPosts ?? []).length === 0 ? <p className="muted-text">当前暂无心灵驿站内容。</p> : null}
                </div>
            </article>

            <article className="panel-card wide">
                <h4>班级风采</h4>
                <div className="media-card-grid">
                    {(detail?.gallery ?? []).map((item) => (
                        <div className="media-card" key={item.id}>
                            {item.fileKind === "image" && item.fileUrl ? (
                                <AuthenticatedImage className="media-card-image" srcPath={item.fileUrl} alt={item.fileName || item.title} />
                            ) : null}
                            <strong>{item.title}</strong>
                            <p>{item.description || "暂无说明"}</p>
                            <small>
                                {item.activityDate || "--"}
                                {item.fileName ? ` · 文件：${item.fileName}` : ""}
                            </small>
                        </div>
                    ))}
                    {(detail?.gallery ?? []).length === 0 ? <p className="muted-text">当前暂无班级风采内容。</p> : null}
                </div>
            </article>

            {error ? <p className="error-text">{error}</p> : null}
        </section>
    );
};
