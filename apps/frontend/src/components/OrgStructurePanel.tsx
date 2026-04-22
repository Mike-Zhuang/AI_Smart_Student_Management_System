import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import { roleLabelMap } from "../lib/labels";

type OrgStructureResponse = {
    summary: {
        classCount: number;
        teacherCount: number;
        studentCount: number;
        headTeacherCount: number;
    };
    classes: OrgClassNode[];
    teachers: OrgTeacherNode[];
};

type OrgClassNode = {
    className: string;
    headTeachers: Array<{
        teacherUserId: number;
        displayName: string;
        subjectName: string | null;
    }>;
    teachers: Array<{
        teacherUserId: number;
        displayName: string;
        username: string;
        subjectName: string | null;
        isHeadTeacher: boolean;
    }>;
    students: Array<{
        id: number;
        studentNo: string;
        name: string;
        grade: string;
    }>;
    studentCount: number;
};

type OrgTeacherNode = {
    teacherUserId: number;
    username: string;
    displayName: string;
    role: "admin" | "teacher" | "head_teacher" | "parent" | "student";
    classes: Array<{
        className: string;
        subjectName: string | null;
        isHeadTeacher: boolean;
    }>;
    totalClasses: number;
    headTeacherClasses: string[];
};

export const OrgStructurePanel = () => {
    const [data, setData] = useState<OrgStructureResponse | null>(null);
    const [viewMode, setViewMode] = useState<"class" | "teacher">("class");
    const [keyword, setKeyword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [expandedGrades, setExpandedGrades] = useState<string[]>(["高一", "高二", "高三"]);
    const [expandedClasses, setExpandedClasses] = useState<string[]>([]);

    const load = async () => {
        setLoading(true);
        setError("");
        try {
            const response = await apiRequest<OrgStructureResponse>("/api/org-structure/overview");
            setData(response.data);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "加载组织架构失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const normalizedKeyword = keyword.trim().toLowerCase();

    const filteredClasses = useMemo(() => {
        const classList = data?.classes ?? [];
        if (!normalizedKeyword) {
            return classList;
        }

        return classList.filter((item) =>
            [
                item.className,
                ...item.headTeachers.map((teacher) => teacher.displayName),
                ...item.teachers.map((teacher) => teacher.displayName),
                ...item.teachers.map((teacher) => teacher.subjectName ?? ""),
                ...item.students.map((student) => student.name),
                ...item.students.map((student) => student.studentNo)
            ].some((value) => value.toLowerCase().includes(normalizedKeyword))
        );
    }, [data?.classes, normalizedKeyword]);

    const filteredTeachers = useMemo(() => {
        const teacherList = data?.teachers ?? [];
        if (!normalizedKeyword) {
            return teacherList;
        }

        return teacherList.filter((item) =>
            [
                item.displayName,
                item.username,
                roleLabelMap[item.role],
                ...item.classes.map((classItem) => classItem.className),
                ...item.classes.map((classItem) => classItem.subjectName ?? "")
            ].some((value) => value.toLowerCase().includes(normalizedKeyword))
        );
    }, [data?.teachers, normalizedKeyword]);

    const groupedClasses = useMemo(() => {
        const groups = new Map<string, OrgClassNode[]>();
        filteredClasses.forEach((item) => {
            const grade = item.students[0]?.grade ?? item.className.match(/高[一二三]/)?.[0] ?? "未分年级";
            groups.set(grade, [...(groups.get(grade) ?? []), item]);
        });
        return Array.from(groups.entries()).sort((left, right) => left[0].localeCompare(right[0], "zh-Hans-CN"));
    }, [filteredClasses]);

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>组织架构</h3>
                <p>这里展示全校班级、班主任、科任教师与学生花名册，方便管理员、班主任和任课教师统一查看组织关系。</p>
                <div className="role-grid org-summary-grid">
                    <div className="role-item">
                        <span>班级总数</span>
                        <strong>{data?.summary.classCount ?? "--"}</strong>
                    </div>
                    <div className="role-item">
                        <span>教师总数</span>
                        <strong>{data?.summary.teacherCount ?? "--"}</strong>
                    </div>
                    <div className="role-item">
                        <span>班主任人数</span>
                        <strong>{data?.summary.headTeacherCount ?? "--"}</strong>
                    </div>
                    <div className="role-item">
                        <span>学生总数</span>
                        <strong>{data?.summary.studentCount ?? "--"}</strong>
                    </div>
                </div>
            </article>

            <article className="panel-card wide">
                <div className="org-toolbar">
                    <div className="org-tabs">
                        <button
                            type="button"
                            className={`secondary-btn ${viewMode === "class" ? "active-tab" : ""}`}
                            onClick={() => setViewMode("class")}
                        >
                            按班级看
                        </button>
                        <button
                            type="button"
                            className={`secondary-btn ${viewMode === "teacher" ? "active-tab" : ""}`}
                            onClick={() => setViewMode("teacher")}
                        >
                            按教师看
                        </button>
                    </div>
                    <div className="inline-form org-search-row">
                        <label>
                            搜索班级 / 教师 / 学生
                            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="例如：高一（1）班、李老师、20260101" />
                        </label>
                        <button type="button" className="secondary-btn" onClick={() => void load()} disabled={loading}>
                            {loading ? "刷新中..." : "刷新组织架构"}
                        </button>
                    </div>
                </div>
                {error ? <p className="error-text">{error}</p> : null}
                {!error && loading && !data ? <p className="muted-text">组织架构加载中...</p> : null}
            </article>

            {viewMode === "class" ? (
                groupedClasses.length > 0 ? (
                    groupedClasses.map(([grade, items]) => {
                        const gradeExpanded = expandedGrades.includes(grade);
                        return (
                            <article key={grade} className="panel-card wide org-card">
                                <div className="list-item-header">
                                    <div>
                                        <h4>{grade}</h4>
                                        <p className="muted-text">{items.length} 个班级，合计 {items.reduce((sum, item) => sum + item.studentCount, 0)} 名学生</p>
                                    </div>
                                    <div className="account-actions">
                                        <button
                                            type="button"
                                            className="secondary-btn"
                                            onClick={() =>
                                                setExpandedGrades((prev) => (gradeExpanded ? prev.filter((item) => item !== grade) : [...prev, grade]))
                                            }
                                        >
                                            {gradeExpanded ? "收起年级" : "展开年级"}
                                        </button>
                                        <button
                                            type="button"
                                            className="secondary-btn"
                                            onClick={() =>
                                                setExpandedClasses((prev) =>
                                                    Array.from(new Set([...prev, ...items.map((item) => item.className)]))
                                                )
                                            }
                                        >
                                            展开本年级全部学生
                                        </button>
                                    </div>
                                </div>

                                {gradeExpanded ? items.map((item) => {
                                    const classExpanded = expandedClasses.includes(item.className);
                                    return (
                                        <div key={item.className} className="org-subcard">
                                            <div className="list-item-header">
                                                <div>
                                                    <h5>{item.className}</h5>
                                                    <p className="muted-text">学生 {item.studentCount} 人</p>
                                                </div>
                                                <div className="account-actions">
                                                    <span className="status-pill">{item.headTeachers.length > 0 ? "班主任已配置" : "班主任待完善"}</span>
                                                    <button
                                                        type="button"
                                                        className="secondary-btn"
                                                        onClick={() =>
                                                            setExpandedClasses((prev) =>
                                                                classExpanded ? prev.filter((target) => target !== item.className) : [...prev, item.className]
                                                            )
                                                        }
                                                    >
                                                        {classExpanded ? "收起学生" : "展开学生"}
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="org-detail-grid">
                                                <div className="org-subcard">
                                                    <h5>班主任</h5>
                                                    {item.headTeachers.length > 0 ? (
                                                        <ul className="timeline-list">
                                                            {item.headTeachers.map((teacher) => (
                                                                <li key={`${item.className}-${teacher.teacherUserId}`}>
                                                                    {teacher.displayName}
                                                                    {teacher.subjectName ? `（${teacher.subjectName}）` : "（学科待完善）"}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <p className="muted-text">当前未配置班主任。</p>
                                                    )}
                                                </div>

                                                <div className="org-subcard">
                                                    <h5>科任教师</h5>
                                                    {item.teachers.length > 0 ? (
                                                        <div className="table-scroll">
                                                            <table>
                                                                <thead>
                                                                    <tr>
                                                                        <th>教师</th>
                                                                        <th>登录账号</th>
                                                                        <th>任教学科</th>
                                                                        <th>身份标记</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {item.teachers.map((teacher) => (
                                                                        <tr key={`${item.className}-${teacher.teacherUserId}-${teacher.subjectName ?? ""}`}>
                                                                            <td>{teacher.displayName}</td>
                                                                            <td>{teacher.username}</td>
                                                                            <td>{teacher.subjectName ?? "待完善"}</td>
                                                                            <td>{teacher.isHeadTeacher ? "班主任 / 科任" : "科任教师"}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : (
                                                        <p className="muted-text">当前未配置科任教师。</p>
                                                    )}
                                                </div>
                                            </div>

                                            {classExpanded ? (
                                                <div className="org-subcard">
                                                    <h5>学生花名册</h5>
                                                    {item.students.length > 0 ? (
                                                        <div className="table-scroll">
                                                            <table>
                                                                <thead>
                                                                    <tr>
                                                                        <th>学号</th>
                                                                        <th>姓名</th>
                                                                        <th>年级</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {item.students.map((student) => (
                                                                        <tr key={student.id}>
                                                                            <td>{student.studentNo}</td>
                                                                            <td>{student.name}</td>
                                                                            <td>{student.grade}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : (
                                                        <p className="muted-text">当前班级还没有学生数据。</p>
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                }) : null}
                            </article>
                        );
                    })
                ) : (
                    <article className="panel-card wide">
                        <p className="muted-text">当前搜索条件下暂无班级组织记录。</p>
                    </article>
                )
            ) : filteredTeachers.length > 0 ? (
                filteredTeachers.map((teacher) => (
                    <article key={teacher.teacherUserId} className="panel-card wide org-card">
                        <div className="list-item-header">
                            <div>
                                <h4>{teacher.displayName}</h4>
                                <p className="muted-text">
                                    {roleLabelMap[teacher.role]} · 登录账号 {teacher.username}
                                </p>
                            </div>
                            <span className="status-pill">
                                {teacher.headTeacherClasses.length > 0 ? `兼任班主任 ${teacher.headTeacherClasses.length} 个班` : "未兼任班主任"}
                            </span>
                        </div>

                        <div className="role-grid">
                            <div className="role-item">
                                <span>任教班级数</span>
                                <strong>{teacher.totalClasses}</strong>
                            </div>
                            <div className="role-item">
                                <span>班主任班级</span>
                                <strong>{teacher.headTeacherClasses.length > 0 ? teacher.headTeacherClasses.join("、") : "无"}</strong>
                            </div>
                        </div>

                        <div className="table-scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th>班级</th>
                                        <th>任教学科</th>
                                        <th>角色</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {teacher.classes.map((classItem, index) => (
                                        <tr key={`${teacher.teacherUserId}-${classItem.className}-${classItem.subjectName ?? ""}-${index}`}>
                                            <td>{classItem.className}</td>
                                            <td>{classItem.subjectName ?? "待完善"}</td>
                                            <td>{classItem.isHeadTeacher ? "班主任 / 科任" : "科任教师"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </article>
                ))
            ) : (
                <article className="panel-card wide">
                    <p className="muted-text">当前搜索条件下暂无教师组织记录。</p>
                </article>
            )}
        </section>
    );
};
