import { FormEvent, useState } from "react";
import { apiRequest } from "../lib/api";
import { downloadFile } from "../lib/export";

const SAMPLE_STUDENT_JSON = `[
  {
    "studentNo": "S2026999",
    "name": "示例学生",
    "grade": "高一",
    "className": "高一(3)班",
    "subjectCombination": "物理+化学+生物",
    "interests": "编程;机器人",
    "careerGoal": "人工智能工程师"
  }
]`;

const SAMPLE_EXAM_JSON = `[
  {
    "studentNo": "S2026999",
    "examName": "2026学年第一学期期中",
    "examDate": "2026-11-18",
    "subject": "数学",
    "score": 88
  }
]`;

export const DataImportPanel = () => {
  const [studentJson, setStudentJson] = useState(SAMPLE_STUDENT_JSON);
  const [examJson, setExamJson] = useState(SAMPLE_EXAM_JSON);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const importStudents = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const rows = JSON.parse(studentJson) as unknown[];
      const response = await apiRequest<{ imported: number }>("/api/data-import/students", {
        method: "POST",
        body: JSON.stringify({ rows })
      });
      setResult(`学生导入成功: ${response.data.imported} 条`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    }
  };

  const importExams = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const rows = JSON.parse(examJson) as unknown[];
      const response = await apiRequest<{ imported: number }>("/api/data-import/exam-results", {
        method: "POST",
        body: JSON.stringify({ rows })
      });
      setResult(`成绩导入成功: ${response.data.imported} 条`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    }
  };

  return (
    <section className="panel-grid">
      <article className="panel-card wide">
        <h3>真实数据导入模板（后期可替换模拟数据）</h3>
        <p>无需去后端目录查找，直接点击下载模板即可开始整理真实数据。</p>
        <div className="inline-form section-actions">
          <button
            className="secondary-btn"
            onClick={() => void downloadFile("/api/data-import/template-files/students", "students-template.csv")}
          >
            下载学生模板
          </button>
          <button
            className="secondary-btn"
            onClick={() => void downloadFile("/api/data-import/template-files/exam-results", "exam-results-template.csv")}
          >
            下载成绩模板
          </button>
          <button
            className="secondary-btn"
            onClick={() => void downloadFile("/api/data-import/template-files/teachers", "teachers-template.csv")}
          >
            下载教师班级模板
          </button>
        </div>
      </article>

      <article className="panel-card wide">
        <h4>导入学生基础数据（JSON）</h4>
        <p>可先用上方 CSV 模板整理数据，再转换为 JSON 导入；后续可平滑升级为批量文件上传。</p>
        <form onSubmit={importStudents} className="form-stack">
          <textarea rows={10} value={studentJson} onChange={(event) => setStudentJson(event.target.value)} />
          <button className="primary-btn" type="submit">
            导入学生
          </button>
        </form>
      </article>

      <article className="panel-card wide">
        <h4>导入考试成绩（JSON）</h4>
        <form onSubmit={importExams} className="form-stack">
          <textarea rows={10} value={examJson} onChange={(event) => setExamJson(event.target.value)} />
          <button className="primary-btn" type="submit">
            导入成绩
          </button>
        </form>
      </article>

      {result ? <p className="success-text">{result}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
};
