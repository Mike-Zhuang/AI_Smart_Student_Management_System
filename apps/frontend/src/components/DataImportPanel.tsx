import { type ChangeEvent, useState } from "react";
import { apiRequest } from "../lib/api";
import { downloadFile } from "../lib/export";

type ImportKind = "students" | "exam-results" | "teachers";

type ImportSummary = {
    total: number;
    imported: number;
    updated: number;
    ignored: number;
    failed: number;
    errors: Array<{
        line: number;
        field: string;
        reason: string;
    }>;
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
        description: "导入学号、姓名、年级、班级、选科与兴趣目标。",
        templateEndpoint: "/api/data-import/template-files/students",
        templateFilename: "students-template.csv",
        uploadEndpoint: "/api/data-import/students"
    },
    {
        kind: "exam-results",
        title: "考试成绩数据",
        description: "导入学号对应的考试名称、日期、科目与分数。",
        templateEndpoint: "/api/data-import/template-files/exam-results",
        templateFilename: "exam-results-template.csv",
        uploadEndpoint: "/api/data-import/exam-results"
    },
    {
        kind: "teachers",
        title: "教师班级关系数据",
        description: "导入教师账号、班级、是否班主任与任教学科。",
        templateEndpoint: "/api/data-import/template-files/teachers",
        templateFilename: "teachers-template.csv",
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
    const [selectedFiles, setSelectedFiles] = useState<Record<ImportKind, File | null>>(defaultFiles);
    const [feedback, setFeedback] = useState<Record<ImportKind, ImportFeedback | null>>(defaultFeedback);
    const [uploadingKind, setUploadingKind] = useState<ImportKind | null>(null);

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
                [kind]: { type: "success", message: "模板下载成功，请在CSV中填写后上传。" }
            }));
        } catch (err) {
            setFeedback((prev) => ({
                ...prev,
                [kind]: { type: "error", message: err instanceof Error ? err.message : "模板下载失败" }
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
                [kind]: { type: "error", message: "请先选择CSV文件" }
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
            const message = `总计 ${summary.total} 行，新增 ${summary.imported} 条，更新 ${summary.updated} 条，失败 ${summary.failed} 行。`;

            setFeedback((prev) => ({
                ...prev,
                [kind]: {
                    type: summary.failed > 0 ? "error" : "success",
                    message,
                    summary
                }
            }));
        } catch (err) {
            setFeedback((prev) => ({
                ...prev,
                [kind]: { type: "error", message: err instanceof Error ? err.message : "导入失败" }
            }));
        } finally {
            setUploadingKind(null);
        }
    };

    return (
        <section className="panel-grid">
            <article className="panel-card wide">
                <h3>真实数据导入（CSV 直传）</h3>
                <p>教师只需要下载模板、填写CSV并上传，不需要手工转换 JSON。</p>
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
                            <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => void handleTemplateDownload(config.kind)}
                                disabled={isUploading}
                            >
                                下载模板
                            </button>
                            <input
                                className="file-upload-input"
                                type="file"
                                accept=".csv,text/csv"
                                onChange={(event) => onFileChange(config.kind, event)}
                                disabled={isUploading}
                            />
                            <button
                                type="button"
                                className="primary-btn"
                                onClick={() => void handleUpload(config.kind)}
                                disabled={isUploading || !currentFile}
                            >
                                {isUploading ? "上传中..." : "上传导入"}
                            </button>
                        </div>

                        <p className="muted-text import-hint">{currentFile ? `已选择：${currentFile.name}` : "请先选择CSV文件"}</p>

                        {currentFeedback ? (
                            <div className="import-result">
                                <p className={currentFeedback.type === "success" ? "success-text" : "error-text"}>{currentFeedback.message}</p>
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
        </section>
    );
};
