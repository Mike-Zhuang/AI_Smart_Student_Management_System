import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { apiRequest } from "../lib/api";
import { downloadFile } from "../lib/export";
import { ConfirmActionButton } from "./ConfirmActionButton";

type ImportKind = "students" | "exam-results" | "teachers";
type ManageKind = ImportKind;

type ImportSummary = {
    total: number;
    imported: number;
    updated: number;
    ignored: number;
    failed: number;
    accountCreated: number;
    accountUpdated: number;
    accountExisting: number;
    issuanceRecords: Array<{
        username: string;
        temporaryPassword: string;
        displayName: string;
        role: string;
        relatedName: string;
    }>;
    issuanceBatchId?: number;
    errors: Array<{
        line: number;
        field: string;
        reason: string;
    }>;
};

type StudentRow = {
    id: number;
    studentNo: string;
    name: string;
    grade: string;
    className: string;
};

type ExamRow = {
    id: number;
    studentNo: string;
    studentName: string;
    className: string;
    examName: string;
    examDate: string;
    subject: string;
    score: number;
};

type TeacherLinkRow = {
    id: number;
    teacherUserId: number;
    teacherUsername: string;
    displayName: string;
    className: string;
    subjectName: string;
    isHeadTeacher: number;
};

type ImportFeedback = {
    type: "success" | "error";
    message: string;
    summary?: ImportSummary;
};

const IMPORT_CONFIG: Array<{
    kind: ImportKind;
    title: string;
    description: string;
    templateEndpoint: string;
    templateFilename: string;
    uploadEndpoint: string;
}> = [
    {
        kind: "students",
        title: "学生基础数据",
        description: "导入学号、姓名、年级、班级、选科与兴趣目标，并自动发放学生账号。",
        templateEndpoint: "/api/data-import/template-files/students",
        templateFilename: "students-template.xlsx",
        uploadEndpoint: "/api/data-import/students"
    },
    {
        kind: "exam-results",
        title: "考试成绩数据",
        description: "导入学号对应的考试名称、日期、科目与分数，并自动修正常见中文乱码。",
        templateEndpoint: "/api/data-import/template-files/exam-results",
        templateFilename: "exam-results-template.xlsx",
        uploadEndpoint: "/api/data-import/exam-results"
    },
    {
        kind: "teachers",
        title: "教师班级关系数据",
        description: "导入教师登录账号、姓名、班级、是否班主任与任教学科，并自动发放教师账号。",
        templateEndpoint: "/api/data-import/template-files/teachers",
        templateFilename: "teachers-template.xlsx",
        uploadEndpoint: "/api/data-import/teachers"
    }
];

const defaultFiles: Record<ImportKind, File | null> = {
    students: null,
    "exam-results": null,
    teachers: null
};

const defaultFeedback: Record<ImportKind, ImportFeedback | null> = {
    students: null,
    "exam-results": null,
    teachers: null
};

export const DataImportPanel = () => {
    const navigate = useNavigate();
    const [selectedFiles, setSelectedFiles] = useState<Record<ImportKind, File | null>>(defaultFiles);
    const [feedback, setFeedback] = useState<Record<ImportKind, ImportFeedback | null>>(defaultFeedback);
    const [uploadingKind, setUploadingKind] = useState<ImportKind | null>(null);

    const [students, setStudents] = useState<StudentRow[]>([]);
    const [studentKeyword, setStudentKeyword] = useState("");
    const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
    const [selectedClassNames, setSelectedClassNames] = useState<string[]>([]);

    const [examRows, setExamRows] = useState<ExamRow[]>([]);
    const [examKeyword, setExamKeyword] = useState("");
    const [examDateFilter, setExamDateFilter] = useState("");
    const [selectedExamIds, setSelectedExamIds] = useState<number[]>([]);

    const [teacherRows, setTeacherRows] = useState<TeacherLinkRow[]>([]);
    const [teacherKeyword, setTeacherKeyword] = useState("");
    const [selectedTeacherIds, setSelectedTeacherIds] = useState<number[]>([]);

    const [manageFeedback, setManageFeedback] = useState<Record<ManageKind, string>>({
        students: "",
        "exam-results": "",
        teachers: ""
    });
    const [managingKind, setManagingKind] = useState<ManageKind | null>(null);

    const loadStudents = async () => {
        const response = await apiRequest<StudentRow[]>("/api/students");
        setStudents([...response.data].sort((left, right) => right.id - left.id));
    };

    const loadExamRows = async () => {
        const query = new URLSearchParams();
        if (examKeyword.trim()) {
            query.set("examName", examKeyword.trim());
        }
        if (examDateFilter.trim()) {
            query.set("examDate", examDateFilter);
        }
        const response = await apiRequest<ExamRow[]>(`/api/data-import/exam-results/manage${query.size ? `?${query.toString()}` : ""}`);
        setExamRows(response.data);
    };

    const loadTeacherRows = async () => {
        const response = await apiRequest<TeacherLinkRow[]>("/api/data-import/teachers/manage");
        setTeacherRows(response.data);
    };

    const loadManageData = async () => {
        try {
            await Promise.all([loadStudents(), loadExamRows(), loadTeacherRows()]);
        } catch (error) {
            const message = error instanceof Error ? error.message : "加载数据管理列表失败";
            setManageFeedback({
                students: message,
                "exam-results": message,
                teachers: message
            });
        }
    };

    useEffect(() => {
        void loadManageData();
    }, []);

    useEffect(() => {
        void loadExamRows();
    }, [examKeyword, examDateFilter]);

    const filteredStudents = useMemo(() => {
        const keyword = studentKeyword.trim().toLowerCase();
        const target = keyword
            ? students.filter((item) =>
                [item.studentNo, item.name, item.grade, item.className].some((value) => value.toLowerCase().includes(keyword))
            )
            : students;
        return target.slice(0, 60);
    }, [studentKeyword, students]);

    const filteredTeachers = useMemo(() => {
        const keyword = teacherKeyword.trim().toLowerCase();
        const target = keyword
            ? teacherRows.filter((item) =>
                [item.teacherUsername, item.displayName, item.className, item.subjectName].some((value) =>
                    String(value ?? "").toLowerCase().includes(keyword)
                )
            )
            : teacherRows;
        return target.slice(0, 80);
    }, [teacherKeyword, teacherRows]);

    const classSummaries = useMemo(() => {
        const summaryMap = new Map<string, { className: string; grade: string; count: number }>();
        students.forEach((item) => {
            const existing = summaryMap.get(item.className);
            if (existing) {
                existing.count += 1;
            } else {
                summaryMap.set(item.className, { className: item.className, grade: item.grade, count: 1 });
            }
        });
        return Array.from(summaryMap.values()).sort((left, right) => left.className.localeCompare(right.className, "zh-Hans-CN"));
    }, [students]);

    const downloadIssuanceRecords = (kind: ImportKind) => {
        const records = feedback[kind]?.summary?.issuanceRecords ?? [];
        if (records.length === 0) {
            return;
        }

        const worksheet = XLSX.utils.json_to_sheet(
            records.map((item) => ({
                账号: item.username,
                初始密码: item.temporaryPassword,
                显示名: item.displayName,
                角色: item.role,
                关联对象: item.relatedName
            }))
        );
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "账号发放单");
        XLSX.writeFile(workbook, `${kind}-account-issuance-${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const onFileChange = (kind: ImportKind, event: ChangeEvent<HTMLInputElement>) => {
        const nextFile = event.target.files?.[0] ?? null;
        setSelectedFiles((prev) => ({ ...prev, [kind]: nextFile }));
        setFeedback((prev) => ({ ...prev, [kind]: null }));
    };

    const handleTemplateDownload = async (kind: ImportKind) => {
        const config = IMPORT_CONFIG.find((item) => item.kind === kind);
        if (!config) {
            return;
        }

        try {
            await downloadFile(config.templateEndpoint, config.templateFilename);
            setFeedback((prev) => ({
                ...prev,
                [kind]: { type: "success", message: "模板下载成功，请在 Excel 或 CSV 中填写后上传。" }
            }));
        } catch (error) {
            setFeedback((prev) => ({
                ...prev,
                [kind]: { type: "error", message: error instanceof Error ? error.message : "模板下载失败" }
            }));
        }
    };

    const handleUpload = async (kind: ImportKind) => {
        const config = IMPORT_CONFIG.find((item) => item.kind === kind);
        if (!config) {
            return;
        }

        const file = selectedFiles[kind];
        if (!file) {
            setFeedback((prev) => ({
                ...prev,
                [kind]: { type: "error", message: "请先选择 Excel 或 CSV 文件" }
            }));
            return;
        }

        setUploadingKind(kind);
        setFeedback((prev) => ({ ...prev, [kind]: null }));

        try {
            const formData = new FormData();
            formData.append("file", file);

            const response = await apiRequest<ImportSummary>(config.uploadEndpoint, {
                method: "POST",
                body: formData
            });

            const summary = response.data;
            const message = `总计 ${summary.total} 行，新增 ${summary.imported} 条，更新 ${summary.updated} 条，失败 ${summary.failed} 行。账号新建 ${summary.accountCreated} 个，账号更新 ${summary.accountUpdated} 个。`;
            setFeedback((prev) => ({
                ...prev,
                [kind]: {
                    type: summary.failed > 0 ? "error" : "success",
                    message,
                    summary
                }
            }));

            if (summary.issuanceRecords.length > 0) {
                downloadIssuanceRecords(kind);
            }

            await loadManageData();
        } catch (error) {
            setFeedback((prev) => ({
                ...prev,
                [kind]: { type: "error", message: error instanceof Error ? error.message : "导入失败" }
            }));
        } finally {
            setUploadingKind(null);
        }
    };

    const batchDeleteStudents = async () => {
        if (selectedStudentIds.length === 0) {
            return;
        }

        setManagingKind("students");
        setManageFeedback((prev) => ({ ...prev, students: "" }));
        try {
            const response = await apiRequest<{ count: number }>("/api/students/batch-delete", {
                method: "POST",
                body: JSON.stringify({ ids: selectedStudentIds })
            });
            setManageFeedback((prev) => ({ ...prev, students: response.message }));
            setSelectedStudentIds([]);
            await loadStudents();
        } catch (error) {
            setManageFeedback((prev) => ({ ...prev, students: error instanceof Error ? error.message : "批量删除学生失败" }));
        } finally {
            setManagingKind(null);
        }
    };

    const batchDeleteExamRows = async () => {
        if (selectedExamIds.length === 0) {
            return;
        }

        setManagingKind("exam-results");
        setManageFeedback((prev) => ({ ...prev, "exam-results": "" }));
        try {
            const response = await apiRequest<{ count?: number }>("/api/data-import/exam-results/batch-delete", {
                method: "POST",
                body: JSON.stringify({ ids: selectedExamIds })
            });
            setManageFeedback((prev) => ({ ...prev, "exam-results": response.message }));
            setSelectedExamIds([]);
            await loadExamRows();
        } catch (error) {
            setManageFeedback((prev) => ({ ...prev, "exam-results": error instanceof Error ? error.message : "批量删除成绩失败" }));
        } finally {
            setManagingKind(null);
        }
    };

    const batchDeleteTeacherRows = async () => {
        if (selectedTeacherIds.length === 0) {
            return;
        }

        setManagingKind("teachers");
        setManageFeedback((prev) => ({ ...prev, teachers: "" }));
        try {
            const response = await apiRequest<{ count?: number }>("/api/data-import/teachers/batch-delete", {
                method: "POST",
                body: JSON.stringify({ ids: selectedTeacherIds })
            });
            setManageFeedback((prev) => ({ ...prev, teachers: response.message }));
            setSelectedTeacherIds([]);
            await loadTeacherRows();
        } catch (error) {
            setManageFeedback((prev) => ({ ...prev, teachers: error instanceof Error ? error.message : "批量删除教师班级关系失败" }));
        } finally {
            setManagingKind(null);
        }
    };

    const batchDeleteClasses = async () => {
        if (selectedClassNames.length === 0) {
            return;
        }

        setManagingKind("students");
        setManageFeedback((prev) => ({ ...prev, students: "" }));
        try {
            const response = await apiRequest<{ summary: Record<string, number> }>("/api/students/classes/batch-delete", {
                method: "POST",
                body: JSON.stringify({ classNames: selectedClassNames })
            });
            setManageFeedback((prev) => ({ ...prev, students: response.message }));
            setSelectedClassNames([]);
            setSelectedStudentIds([]);
            await loadManageData();
        } catch (error) {
            setManageFeedback((prev) => ({ ...prev, students: error instanceof Error ? error.message : "整班删除失败" }));
        } finally {
            setManagingKind(null);
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>真实数据导入与清理</h3>
                <p>支持 XLSX、UTF-8 CSV、GBK/GB18030 CSV 直传。系统会尽量修复中文乱码，并提供导入后管理与批量删除入口。</p>
                <p className="muted-text">账号初始密码不会在系统中长期明文保存。若导入时生成了新账号，系统会自动下载账号发放单；若当时忘记保存，也可以稍后到“我的账号 → 账号发放台账”重新下载未改密账号。</p>
            </article>

            {IMPORT_CONFIG.map((config) => {
                const currentFeedback = feedback[config.kind];
                const currentFile = selectedFiles[config.kind];
                const isUploading = uploadingKind === config.kind;
                const hasErrors = (currentFeedback?.summary?.errors ?? []).length > 0;

                return (
                    <article key={config.kind} className="panel-card">
                        <h4>{config.title}</h4>
                        <p>{config.description}</p>
                        <div className="file-upload-row section-actions">
                            <button type="button" className="secondary-btn" onClick={() => void handleTemplateDownload(config.kind)} disabled={isUploading}>
                                下载模板
                            </button>
                            <input
                                className="file-upload-input"
                                type="file"
                                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                onChange={(event) => onFileChange(config.kind, event)}
                                disabled={isUploading}
                            />
                            <button type="button" className="primary-btn" onClick={() => void handleUpload(config.kind)} disabled={isUploading || !currentFile}>
                                {isUploading ? "上传中..." : "上传导入"}
                            </button>
                        </div>

                        <p className="muted-text import-hint">{currentFile ? `已选择：${currentFile.name}` : "请先选择 Excel 或 CSV 文件"}</p>

                        {currentFeedback ? (
                            <div className="import-result">
                                <p className={currentFeedback.type === "success" ? "success-text" : "error-text"}>{currentFeedback.message}</p>
                                {currentFeedback.summary?.issuanceRecords?.length ? (
                                    <>
                                        <p className="warning-box">本次导入已生成一次性初始密码，请立即下载账号发放单并完成发放。</p>
                                        <div className="account-actions">
                                            <button type="button" className="secondary-btn" onClick={() => downloadIssuanceRecords(config.kind)}>
                                                下载账号发放单
                                            </button>
                                            {currentFeedback.summary.issuanceBatchId ? (
                                                <button
                                                    type="button"
                                                    className="secondary-btn"
                                                    onClick={() => navigate(`/dashboard/account?batchId=${currentFeedback.summary?.issuanceBatchId ?? ""}`)}
                                                >
                                                    查看本次发放批次
                                                </button>
                                            ) : null}
                                        </div>
                                    </>
                                ) : null}
                                {hasErrors ? (
                                    <ul className="import-error-list">
                                        {currentFeedback.summary!.errors.slice(0, 8).map((item, index) => (
                                            <li key={`${item.line}-${item.field}-${index}`}>
                                                第 {item.line} 行 · {item.field}：{item.reason}
                                            </li>
                                        ))}
                                        {currentFeedback.summary!.errors.length > 8 ? (
                                            <li>其余 {currentFeedback.summary!.errors.length - 8} 条错误请按模板修正后重试。</li>
                                        ) : null}
                                    </ul>
                                ) : null}
                            </div>
                        ) : null}
                    </article>
                );
            })}

            <article className="panel-card wide">
                <h3>学生数据清理</h3>
                <p>用于删除误导入、测试或乱码学生。删除后会级联移除成绩、画像、预警、选科建议与学生账号。</p>
                <div className="inline-form section-actions">
                    <label>
                        搜索学生
                        <input value={studentKeyword} onChange={(event) => setStudentKeyword(event.target.value)} placeholder="输入学号、姓名、年级或班级" />
                    </label>
                    <button type="button" className="secondary-btn" onClick={() => void loadStudents()}>
                        刷新学生列表
                    </button>
                    <ConfirmActionButton
                        className="primary-btn"
                        disabled={selectedStudentIds.length === 0 || managingKind === "students"}
                        loadingText="删除中..."
                        buttonText={`批量删除学生（${selectedStudentIds.length}）`}
                        confirmTitle="确认批量删除学生"
                        confirmMessage={`确定删除选中的 ${selectedStudentIds.length} 名学生吗？系统会同时删除其成绩、画像、预警、选科建议、学生账号以及关联家长绑定。`}
                        onConfirm={batchDeleteStudents}
                    />
                </div>
                {manageFeedback.students ? <p className={manageFeedback.students.includes("删除") ? "success-text" : "error-text"}>{manageFeedback.students}</p> : null}
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th>班级</th>
                                <th>年级</th>
                                <th>学生数</th>
                            </tr>
                        </thead>
                        <tbody>
                            {classSummaries.map((item) => (
                                <tr key={`class-summary-${item.className}`}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedClassNames.includes(item.className)}
                                            onChange={(event) =>
                                                setSelectedClassNames((prev) =>
                                                    event.target.checked ? [...prev, item.className] : prev.filter((value) => value !== item.className)
                                                )
                                            }
                                        />
                                    </td>
                                    <td>{item.className}</td>
                                    <td>{item.grade}</td>
                                    <td>{item.count}</td>
                                </tr>
                            ))}
                            {classSummaries.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="muted-text">当前暂无可清理班级。</td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
                <div className="inline-form section-actions compact-actions">
                    <ConfirmActionButton
                        className="primary-btn"
                        disabled={selectedClassNames.length === 0 || managingKind === "students"}
                        loadingText="删除中..."
                        buttonText={`整班级联删除（${selectedClassNames.length}）`}
                        confirmTitle="确认整班级联删除"
                        confirmMessage={`确定整班删除 ${selectedClassNames.length} 个班级吗？系统会级联删除学生、成绩、画像、预警、选科建议、请假、班级简介、班级日志、心灵驿站、班级风采、小组积分、教师班级关系，以及失去关联后的学生/家长/教师账号。`}
                        onConfirm={batchDeleteClasses}
                    />
                </div>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th>学号</th>
                                <th>姓名</th>
                                <th>年级</th>
                                <th>班级</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredStudents.map((item) => (
                                <tr key={item.id}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedStudentIds.includes(item.id)}
                                            onChange={(event) =>
                                                setSelectedStudentIds((prev) => (event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)))
                                            }
                                        />
                                    </td>
                                    <td>{item.studentNo}</td>
                                    <td>{item.name}</td>
                                    <td>{item.grade}</td>
                                    <td>{item.className}</td>
                                </tr>
                            ))}
                            {filteredStudents.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="muted-text">未找到匹配学生。</td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </article>

            <article className="panel-card wide">
                <h3>成绩数据清理</h3>
                <p>可按考试名称、考试日期筛选误导入成绩，并进行批量删除。若未导入成绩，成长页会显示“暂无成绩数据，请先导入成绩”。</p>
                <div className="inline-form section-actions">
                    <label>
                        考试名称
                        <input value={examKeyword} onChange={(event) => setExamKeyword(event.target.value)} placeholder="例如：高一下期中考试" />
                    </label>
                    <label>
                        考试日期
                        <input type="date" value={examDateFilter} onChange={(event) => setExamDateFilter(event.target.value)} />
                    </label>
                    <button type="button" className="secondary-btn" onClick={() => void loadExamRows()}>
                        刷新成绩列表
                    </button>
                    <ConfirmActionButton
                        className="primary-btn"
                        disabled={selectedExamIds.length === 0 || managingKind === "exam-results"}
                        loadingText="删除中..."
                        buttonText={`批量删除成绩（${selectedExamIds.length}）`}
                        confirmTitle="确认批量删除成绩"
                        confirmMessage={`确定删除选中的 ${selectedExamIds.length} 条成绩记录吗？删除后相关成长趋势会同步更新。`}
                        onConfirm={batchDeleteExamRows}
                    />
                </div>
                {manageFeedback["exam-results"] ? <p className={manageFeedback["exam-results"].includes("删除") ? "success-text" : "error-text"}>{manageFeedback["exam-results"]}</p> : null}
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th>考试名称</th>
                                <th>考试日期</th>
                                <th>学生</th>
                                <th>班级</th>
                                <th>科目</th>
                                <th>分数</th>
                            </tr>
                        </thead>
                        <tbody>
                            {examRows.slice(0, 120).map((item) => (
                                <tr key={item.id}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedExamIds.includes(item.id)}
                                            onChange={(event) =>
                                                setSelectedExamIds((prev) => (event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)))
                                            }
                                        />
                                    </td>
                                    <td>{item.examName}</td>
                                    <td>{item.examDate}</td>
                                    <td>{item.studentName}（{item.studentNo}）</td>
                                    <td>{item.className}</td>
                                    <td>{item.subject}</td>
                                    <td>{item.score}</td>
                                </tr>
                            ))}
                            {examRows.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="muted-text">当前筛选条件下暂无成绩记录。</td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </article>

            <article className="panel-card wide">
                <h3>教师班级关系清理</h3>
                <p>用于清理错误导入的教师—班级映射。若教师不再关联任何班级且角色不是管理员，系统会同步删除教师账号。</p>
                <div className="inline-form section-actions">
                    <label>
                        搜索教师或班级
                        <input value={teacherKeyword} onChange={(event) => setTeacherKeyword(event.target.value)} placeholder="输入账号、姓名、班级或学科" />
                    </label>
                    <button type="button" className="secondary-btn" onClick={() => void loadTeacherRows()}>
                        刷新教师列表
                    </button>
                    <ConfirmActionButton
                        className="primary-btn"
                        disabled={selectedTeacherIds.length === 0 || managingKind === "teachers"}
                        loadingText="删除中..."
                        buttonText={`批量删除关系（${selectedTeacherIds.length}）`}
                        confirmTitle="确认批量删除教师班级关系"
                        confirmMessage={`确定删除选中的 ${selectedTeacherIds.length} 条教师班级关系吗？若教师失去全部班级关系且不是管理员，教师账号也会同步删除。`}
                        onConfirm={batchDeleteTeacherRows}
                    />
                </div>
                {manageFeedback.teachers ? <p className={manageFeedback.teachers.includes("删除") ? "success-text" : "error-text"}>{manageFeedback.teachers}</p> : null}
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th>账号</th>
                                <th>姓名</th>
                                <th>班级</th>
                                <th>学科</th>
                                <th>身份</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTeachers.map((item) => (
                                <tr key={item.id}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedTeacherIds.includes(item.id)}
                                            onChange={(event) =>
                                                setSelectedTeacherIds((prev) => (event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)))
                                            }
                                        />
                                    </td>
                                    <td>{item.teacherUsername}</td>
                                    <td>{item.displayName}</td>
                                    <td>{item.className}</td>
                                    <td>{item.subjectName || "待补充"}</td>
                                    <td>{item.isHeadTeacher ? "班主任" : "任课教师"}</td>
                                </tr>
                            ))}
                            {filteredTeachers.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="muted-text">未找到匹配教师关系。</td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </article>
        </section>
    );
};
