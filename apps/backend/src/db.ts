import Database from "better-sqlite3";
import dayjs from "dayjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROLES } from "./constants.js";
import {
    isValidStageForGrade,
    normalizeStageFromGrade,
    parseSubjectCombination,
    validateSelectionByStage
} from "./utils/subjectRules.js";
import { hashPassword } from "./utils/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const dataDir = path.join(appRoot, "data");
const dbPath = path.join(dataDir, "app.db");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const createSchema = (): void => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      linked_student_id INTEGER,
      phone TEXT,
      email TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      password_reset_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_no TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      grade TEXT NOT NULL,
      class_name TEXT NOT NULL,
      subject_combination TEXT,
            academic_stage TEXT NOT NULL DEFAULT '高一下',
            subject_selection_status TEXT NOT NULL DEFAULT 'not_started',
            first_selected_subject TEXT,
            second_selected_subject TEXT,
            third_selected_subject TEXT,
      interests TEXT,
      career_goal TEXT,
      parent_user_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parent_student_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_user_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      relation TEXT NOT NULL DEFAULT '监护人',
      created_at TEXT NOT NULL,
      UNIQUE(parent_user_id, student_id),
      FOREIGN KEY(parent_user_id) REFERENCES users(id),
      FOREIGN KEY(student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS teacher_class_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_user_id INTEGER NOT NULL,
      class_name TEXT NOT NULL,
            subject_name TEXT,
      is_head_teacher INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(teacher_user_id, class_name),
      FOREIGN KEY(teacher_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS exam_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      exam_name TEXT NOT NULL,
      exam_date TEXT NOT NULL,
      score REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS behavior_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      behavior_type TEXT NOT NULL,
      score_delta REAL NOT NULL,
      description TEXT NOT NULL,
      record_date TEXT NOT NULL,
      FOREIGN KEY(student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS growth_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER UNIQUE NOT NULL,
      summary TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      last_updated TEXT NOT NULL,
      FOREIGN KEY(student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_user_id INTEGER,
      receiver_user_id INTEGER,
      receiver_role TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      module TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      parent_user_id INTEGER,
      reason TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL,
      review_note TEXT,
      reviewed_by INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS career_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      selected_combination TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      major_suggestions TEXT NOT NULL,
      score_breakdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS teaching_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      due_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teaching_research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      performance_score REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public_major_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      region TEXT NOT NULL,
      university TEXT NOT NULL,
      major TEXT NOT NULL,
      required_subjects TEXT NOT NULL,
      reference_score INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action_module TEXT NOT NULL,
      action_type TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id INTEGER,
      detail TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT,
            scenario TEXT,
            model TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            reasoning_content TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated_at
            ON chat_sessions(user_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at
            ON chat_messages(session_id, created_at ASC);
  `);
};

const createUser = (
    username: string,
    displayName: string,
    role: string,
    password: string,
    linkedStudentId: number | null = null,
    mustChangePassword = false
): number => {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined;
    if (existing) {
        return existing.id;
    }

    const result = db.prepare(
        `INSERT INTO users (
            username,
            display_name,
            password_hash,
            role,
            linked_student_id,
            must_change_password,
            password_reset_at,
            created_at
        )
        VALUES (
            @username,
            @displayName,
            @passwordHash,
            @role,
            @linkedStudentId,
            @mustChangePassword,
            @passwordResetAt,
            @createdAt
        )`
    ).run({
        username,
        displayName,
        passwordHash: hashPassword(password),
        role,
        linkedStudentId,
        mustChangePassword: mustChangePassword ? 1 : 0,
        passwordResetAt: mustChangePassword ? dayjs().toISOString() : null,
        createdAt: dayjs().toISOString()
    });

    return Number(result.lastInsertRowid);
};

const seedPublicData = (): void => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM public_major_requirements").get() as { count: number };
    if (count.count > 0) {
        return;
    }

    const rows = [
        [2025, "黑龙江", "哈尔滨工业大学", "计算机科学与技术", "物理+化学", 646],
        [2025, "黑龙江", "哈尔滨工业大学", "自动化", "物理+化学", 639],
        [2025, "黑龙江", "北京师范大学", "教育技术学", "物理不限", 632],
        [2025, "黑龙江", "东北师范大学", "思想政治教育", "政治", 604],
        [2025, "黑龙江", "东北林业大学", "林学", "物理或生物", 565],
        [2025, "黑龙江", "上海交通大学", "临床医学", "物理+化学+生物", 672],
        [2025, "黑龙江", "中国人民大学", "法学", "历史+政治", 661],
        [2025, "黑龙江", "华中科技大学", "电子信息工程", "物理+化学", 648]
    ] as const;

    const stmt = db.prepare(
        `INSERT INTO public_major_requirements (year, region, university, major, required_subjects, reference_score)
     VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
        stmt.run(...row);
    }
};

const seedDemoData = (): void => {
    const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

    const adminId = createUser("admin", "系统管理员", ROLES.ADMIN, "admin123");
    const teacherZhangId = createUser("teacher_zhang", "张老师", ROLES.TEACHER, "teacher123");
    const teacherWuId = createUser("teacher_wu", "吴老师", ROLES.TEACHER, "teacher123");
    const headLiId = createUser("head_li", "李班主任", ROLES.HEAD_TEACHER, "head123");
    const headChenId = createUser("head_chen", "陈班主任", ROLES.HEAD_TEACHER, "head123");
    const parentWangId = createUser("parent_wang", "王家长", ROLES.PARENT, "parent123");
    const parentLiuId = createUser("parent_liu", "刘家长", ROLES.PARENT, "parent123");

    const parentPool: number[] = [parentWangId, parentLiuId];
    for (let i = 1; i <= 336; i += 1) {
        parentPool.push(
            createUser(`parent_auto_${String(i).padStart(4, "0")}`, `家长${String(i).padStart(4, "0")}`, ROLES.PARENT, "parent123")
        );
    }

    const insertStudent = db.prepare(
        `INSERT OR IGNORE INTO students (student_no, name, grade, class_name, subject_combination, interests, career_goal, parent_user_id, created_at)
     VALUES (@studentNo, @name, @grade, @className, @subjectCombination, @interests, @careerGoal, @parentUserId, @createdAt)`
    );

    const combinations = ["物理+化学+生物", "物理+化学+政治", "物理+生物+地理", "历史+政治+地理", "历史+生物+地理"];
    const interests = ["编程,机器人", "文学,历史", "生物,医学", "法律,辩论", "财经,管理", "艺术,设计", "体育,康复", "心理学,社会学"];
    const goals = ["人工智能工程师", "临床医生", "中学教师", "律师", "产品经理", "数据分析师", "建筑设计师", "新能源工程师"];

    const existingStudentCount = (db.prepare("SELECT COUNT(*) as count FROM students").get() as { count: number }).count;
    const targetStudentCount = 1000;
    for (let i = existingStudentCount + 1; i <= targetStudentCount; i += 1) {
        const grade = i <= 334 ? "高一" : i <= 667 ? "高二" : "高三";
        const className = `${grade}(${(i % 5) + 1})班`;
        const parentUserId = parentPool[i % parentPool.length];

        insertStudent.run({
            studentNo: `S2026${String(i).padStart(4, "0")}`,
            name: `学生${String(i).padStart(4, "0")}`,
            grade,
            className,
            subjectCombination: combinations[i % combinations.length],
            interests: interests[i % interests.length],
            careerGoal: goals[i % goals.length],
            parentUserId,
            createdAt: dayjs().subtract(9, "month").add(i % 90, "day").toISOString()
        });
    }

    const students = db.prepare("SELECT id, parent_user_id as parentUserId, class_name as className FROM students ORDER BY id ASC").all() as Array<{
        id: number;
        parentUserId: number | null;
        className: string;
    }>;

    const stageBackfillStmt = db.prepare(
        `UPDATE students
         SET academic_stage = ?,
             subject_selection_status = ?,
             first_selected_subject = ?,
             second_selected_subject = ?,
             third_selected_subject = ?,
             subject_combination = ?
         WHERE id = ?`
    );

    const studentRuleRows = db
        .prepare(`SELECT id, grade, subject_combination as subjectCombination FROM students`)
        .all() as Array<{ id: number; grade: string; subjectCombination: string | null }>;

    for (const item of studentRuleRows) {
        const stage = normalizeStageFromGrade(item.grade, item.id);
        const parsed = parseSubjectCombination(item.subjectCombination);
        const result = validateSelectionByStage({
            stage,
            firstSelectedSubject: parsed.first,
            secondSelectedSubject: parsed.second,
            thirdSelectedSubject: parsed.third
        });

        if (result.ok) {
            stageBackfillStmt.run(
                stage,
                result.selectionStatus,
                result.firstSelectedSubject,
                result.secondSelectedSubject,
                result.thirdSelectedSubject,
                result.subjectCombination,
                item.id
            );
            continue;
        }

        stageBackfillStmt.run(stage, "locked", null, null, null, null, item.id);
    }

    const firstStudent = students[0];
    const secondStudent = students[1];
    const student001Id = createUser("student_001", "演示学生A", ROLES.STUDENT, "student123", firstStudent?.id ?? null);
    const student002Id = createUser("student_002", "演示学生B", ROLES.STUDENT, "student123", secondStudent?.id ?? null);

    db.prepare("UPDATE users SET linked_student_id = ? WHERE id = ?").run(firstStudent?.id ?? null, student001Id);
    db.prepare("UPDATE users SET linked_student_id = ? WHERE id = ?").run(secondStudent?.id ?? null, student002Id);

    db.prepare("DELETE FROM teacher_class_links WHERE teacher_user_id IN (?, ?, ?, ?)").run(
        teacherZhangId,
        teacherWuId,
        headLiId,
        headChenId
    );
    const classLinkStmt = db.prepare(
          `INSERT OR IGNORE INTO teacher_class_links (teacher_user_id, class_name, subject_name, is_head_teacher, created_at)
      VALUES (?, ?, ?, ?, ?)`
    );
     classLinkStmt.run(teacherZhangId, "高一(1)班", "数学", 0, dayjs().toISOString());
     classLinkStmt.run(teacherZhangId, "高一(2)班", "数学", 0, dayjs().toISOString());
     classLinkStmt.run(teacherWuId, "高二(1)班", "英语", 0, dayjs().toISOString());
     classLinkStmt.run(teacherWuId, "高二(2)班", "英语", 0, dayjs().toISOString());
     classLinkStmt.run(headLiId, "高一(1)班", "班主任", 1, dayjs().toISOString());
     classLinkStmt.run(headLiId, "高一(3)班", "班主任", 1, dayjs().toISOString());
     classLinkStmt.run(headChenId, "高二(1)班", "班主任", 1, dayjs().toISOString());
     classLinkStmt.run(headChenId, "高二(3)班", "班主任", 1, dayjs().toISOString());

    const parentLinkInsert = db.prepare(
        `INSERT OR IGNORE INTO parent_student_links (parent_user_id, student_id, relation, created_at)
     VALUES (?, ?, ?, ?)`
    );

    for (const student of students) {
        if (student.parentUserId) {
            parentLinkInsert.run(student.parentUserId, student.id, "监护人", dayjs().toISOString());
        }

        const secondParent = parentPool[(student.id + 17) % parentPool.length];
        const thirdParent = parentPool[(student.id + 43) % parentPool.length];
        if (student.id % 11 === 0 && secondParent !== student.parentUserId) {
            parentLinkInsert.run(secondParent, student.id, "共同监护人", dayjs().toISOString());
        }
        if (student.id % 37 === 0 && thirdParent !== student.parentUserId && thirdParent !== secondParent) {
            parentLinkInsert.run(thirdParent, student.id, "共同监护人", dayjs().toISOString());
        }
    }

    const demoStudents = students.slice(0, 6).map((item) => item.id);
    db.prepare("DELETE FROM parent_student_links WHERE parent_user_id IN (?, ?)").run(parentWangId, parentLiuId);
    demoStudents.slice(0, 3).forEach((studentId) => {
        parentLinkInsert.run(parentWangId, studentId, "监护人", dayjs().toISOString());
        db.prepare("UPDATE students SET parent_user_id = ? WHERE id = ?").run(parentWangId, studentId);
    });
    demoStudents.slice(3, 6).forEach((studentId) => {
        parentLinkInsert.run(parentLiuId, studentId, "监护人", dayjs().toISOString());
        db.prepare("UPDATE students SET parent_user_id = ? WHERE id = ?").run(parentLiuId, studentId);
    });

    const subjects = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "政治", "地理"];
    const subjectBias: Record<string, number> = {
        语文: 3,
        数学: 0,
        英语: 2,
        物理: -1,
        化学: 0,
        生物: 1,
        历史: 2,
        政治: 1,
        地理: 0
    };
    const exams = [
        { name: "2025学年第一学期期中", date: "2025-11-15", shift: -3 },
        { name: "2025学年第一学期期末", date: "2026-01-20", shift: 1 },
        { name: "2025学年第二学期月考", date: "2026-03-12", shift: 4 },
        { name: "2025学年第二学期期中", date: "2026-04-25", shift: -1 },
        { name: "2025学年第二学期期末", date: "2026-06-28", shift: 6 }
    ];

    const examCountMeta = db.prepare("SELECT COUNT(*) as count, COUNT(DISTINCT exam_name) as examCount FROM exam_results").get() as {
        count: number;
        examCount: number;
    };
    const expectedRows = students.length * subjects.length * exams.length;

    if (examCountMeta.examCount < exams.length || examCountMeta.count < Math.floor(expectedRows * 0.85)) {
        db.prepare("DELETE FROM exam_results").run();
        const resultStmt = db.prepare(
            `INSERT INTO exam_results (student_id, subject, exam_name, exam_date, score, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
        );

        for (const student of students) {
            const baseline = 58 + ((student.id * 13) % 30);
            for (let examIndex = 0; examIndex < exams.length; examIndex += 1) {
                const exam = exams[examIndex];
                for (const subject of subjects) {
                    const noise = ((student.id + subject.charCodeAt(0) * 3 + examIndex * 7) % 13) - 6;
                    const dip = student.id % 17 === 0 && examIndex === 1 ? -8 : 0;
                    const rebound = student.id % 17 === 0 && examIndex === 4 ? 5 : 0;
                    const score = clamp(baseline + (subjectBias[subject] ?? 0) + exam.shift + noise + dip + rebound, 35, 99);
                    resultStmt.run(student.id, subject, exam.name, exam.date, Number(score.toFixed(1)), dayjs().toISOString());
                }
            }
        }
    }

    const growthStmt = db.prepare(
        `INSERT INTO growth_profiles (student_id, summary, risk_level, last_updated)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(student_id) DO UPDATE SET
       summary = excluded.summary,
       risk_level = excluded.risk_level,
       last_updated = excluded.last_updated`
    );

    for (const student of students) {
        const risk = student.id % 10 === 0 ? "high" : student.id % 4 === 0 ? "medium" : "low";
        growthStmt.run(
            student.id,
            `${student.className}学生在最近五次考试中呈现阶段波动。建议围绕薄弱学科做“周测-复盘-错题回归”闭环。`,
            risk,
            dayjs().toISOString()
        );
    }

    const alertCount = (db.prepare("SELECT COUNT(*) as count FROM alerts").get() as { count: number }).count;
    if (alertCount < 400) {
        db.prepare("DELETE FROM alerts").run();
        const alertStmt = db.prepare(
            `INSERT INTO alerts (student_id, alert_type, content, status, created_at)
       VALUES (?, ?, ?, ?, ?)`
        );
        for (const student of students) {
            if (student.id % 10 === 0) {
                alertStmt.run(student.id, "academic", "连续两次考试核心学科低于班级均值，建议家校联合干预。", "open", dayjs().subtract(student.id % 8, "day").toISOString());
                alertStmt.run(student.id, "behavior", "课堂参与度下降，建议与班主任进行面谈并追踪两周。", "open", dayjs().subtract((student.id % 8) + 1, "day").toISOString());
            } else if (student.id % 4 === 0) {
                alertStmt.run(student.id, "academic", "英语学科波动较大，建议增加听力与阅读分层训练。", "open", dayjs().subtract(student.id % 10, "day").toISOString());
            }
        }
    }

    const recommendationCount = (db.prepare("SELECT COUNT(*) as count FROM career_recommendations").get() as { count: number }).count;
    if (recommendationCount < 200) {
        const recStmt = db.prepare(
            `INSERT INTO career_recommendations (student_id, model, selected_combination, reasoning, major_suggestions, score_breakdown, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const student of students.slice(0, 260)) {
            const combination = combinations[student.id % combinations.length];
            const confidence = 62 + (student.id % 30);
            const scoreBreakdown = {
                science: 60 + (student.id % 32),
                social: 58 + ((student.id * 3) % 31),
                logic: 62 + ((student.id * 5) % 29),
                language: 57 + ((student.id * 7) % 27),
                stability: 64 + ((student.id * 2) % 26),
                confidence,
                evidenceChain: [
                    { dimension: "science", evidence: "理化生均分位于年级中上区间", impact: "支撑理工类专业适配" },
                    { dimension: "language", evidence: "语文英语保持稳定", impact: "利于综合表达与面试表现" }
                ],
                counterfactual: "若历史政治提升8分，可扩大文社类专业覆盖。"
            };

            recStmt.run(
                student.id,
                "glm-4.7-flash",
                combination,
                "基于阶段成绩与兴趣目标生成结构化推荐，建议结合班主任访谈后最终确认。",
                "计算机科学与技术,自动化,软件工程",
                JSON.stringify(scoreBreakdown),
                dayjs().subtract(student.id % 30, "day").toISOString()
            );
        }
    }

    const messageCount = (db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }).count;
    if (messageCount < 300) {
        const messageStmt = db.prepare(
            `INSERT INTO messages (sender_user_id, receiver_user_id, receiver_role, title, content, module, created_at, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (let i = 1; i <= 320; i += 1) {
            const receiver = parentPool[i % parentPool.length];
            const sender = i % 2 === 0 ? headLiId : teacherZhangId;
            messageStmt.run(
                sender,
                receiver,
                ROLES.PARENT,
                `家校周报提醒 #${i}`,
                `第${i}期家校沟通提醒：请关注本周作业完成率与课堂表现，并于周五前完成回执。`,
                "home-school",
                dayjs().subtract(i % 28, "day").toISOString(),
                i % 5 === 0 ? 0 : 1
            );
        }
    }

    const leaveCount = (db.prepare("SELECT COUNT(*) as count FROM leave_requests").get() as { count: number }).count;
    if (leaveCount < 120) {
        const leaveStmt = db.prepare(
            `INSERT INTO leave_requests (student_id, parent_user_id, reason, start_date, end_date, status, review_note, reviewed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const student of students.slice(0, 140)) {
            const status = student.id % 6 === 0 ? "pending" : student.id % 2 === 0 ? "approved" : "rejected";
            leaveStmt.run(
                student.id,
                student.parentUserId ?? parentWangId,
                student.id % 3 === 0 ? "发热居家观察" : "家庭事务请假",
                dayjs().subtract(student.id % 20, "day").format("YYYY-MM-DD"),
                dayjs().subtract((student.id % 20) - 1, "day").format("YYYY-MM-DD"),
                status,
                status === "approved" ? "请按时返校并提交健康记录" : status === "rejected" ? "请补充医疗凭证" : null,
                status === "pending" ? null : (student.id % 2 === 0 ? headLiId : teacherZhangId),
                dayjs().subtract(student.id % 20, "day").toISOString()
            );
        }
    }

    const taskCount = (db.prepare("SELECT COUNT(*) as count FROM teaching_tasks").get() as { count: number }).count;
    if (taskCount < 100) {
        const taskStmt = db.prepare(
            `INSERT INTO teaching_tasks (teacher_user_id, title, task_type, status, due_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
        );
        const taskTypes = ["lesson_plan", "research", "communication", "training"];
        const statuses = ["todo", "in_progress", "done"];
        for (let i = 1; i <= 120; i += 1) {
            const teacherId = i % 3 === 0 ? headLiId : i % 2 === 0 ? teacherWuId : teacherZhangId;
            taskStmt.run(
                teacherId,
                `教研任务 #${i}`,
                taskTypes[i % taskTypes.length],
                statuses[i % statuses.length],
                dayjs().add((i % 35) + 1, "day").format("YYYY-MM-DD"),
                dayjs().subtract(i % 25, "day").toISOString()
            );
        }
    }

    const researchCount = (db.prepare("SELECT COUNT(*) as count FROM teaching_research").get() as { count: number }).count;
    if (researchCount < 60) {
        const researchStmt = db.prepare(
            `INSERT INTO teaching_research (teacher_user_id, title, content, category, performance_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
        );
        const categories = ["教研论文", "课堂改进", "班主任管理", "课程设计"];
        for (let i = 1; i <= 72; i += 1) {
            const teacherId = i % 3 === 0 ? headChenId : i % 2 === 0 ? teacherWuId : teacherZhangId;
            researchStmt.run(
                teacherId,
                `教研成果 #${i}`,
                `围绕第${i}次教学实践形成改进结论：通过分层目标与过程反馈，课堂达成度持续提升。`,
                categories[i % categories.length],
                Number((78 + (i % 20) + (i % 5) * 0.6).toFixed(1)),
                dayjs().subtract(i % 40, "day").toISOString()
            );
        }
    }

    const inviteStmt = db.prepare(
        `INSERT OR IGNORE INTO invite_codes (code, role, expires_at, used, created_at)
     VALUES (?, ?, ?, 0, ?)`
    );

    inviteStmt.run("INVITE-TEACHER-2026", ROLES.TEACHER, dayjs().add(90, "day").toISOString(), dayjs().toISOString());
    inviteStmt.run("INVITE-HEAD-2026", ROLES.HEAD_TEACHER, dayjs().add(90, "day").toISOString(), dayjs().toISOString());
    inviteStmt.run("INVITE-PARENT-2026", ROLES.PARENT, dayjs().add(90, "day").toISOString(), dayjs().toISOString());
    inviteStmt.run("INVITE-STUDENT-2026", ROLES.STUDENT, dayjs().add(90, "day").toISOString(), dayjs().toISOString());
    void adminId;
    void headChenId;
    void student002Id;
};

export const initDatabase = (): void => {
    createSchema();

    const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
    if (!userColumns.some((item) => item.name === "phone")) {
        db.exec(`ALTER TABLE users ADD COLUMN phone TEXT`);
    }
    if (!userColumns.some((item) => item.name === "email")) {
        db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
    }
    if (!userColumns.some((item) => item.name === "must_change_password")) {
        db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`);
    }
    if (!userColumns.some((item) => item.name === "password_reset_at")) {
        db.exec(`ALTER TABLE users ADD COLUMN password_reset_at TEXT`);
    }
    if (!userColumns.some((item) => item.name === "is_active")) {
        db.exec(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
    }

    const studentColumns = db.prepare(`PRAGMA table_info(students)`).all() as Array<{ name: string }>;
    if (!studentColumns.some((item) => item.name === "academic_stage")) {
        db.exec(`ALTER TABLE students ADD COLUMN academic_stage TEXT`);
    }
    if (!studentColumns.some((item) => item.name === "subject_selection_status")) {
        db.exec(`ALTER TABLE students ADD COLUMN subject_selection_status TEXT`);
    }
    if (!studentColumns.some((item) => item.name === "first_selected_subject")) {
        db.exec(`ALTER TABLE students ADD COLUMN first_selected_subject TEXT`);
    }
    if (!studentColumns.some((item) => item.name === "second_selected_subject")) {
        db.exec(`ALTER TABLE students ADD COLUMN second_selected_subject TEXT`);
    }
    if (!studentColumns.some((item) => item.name === "third_selected_subject")) {
        db.exec(`ALTER TABLE students ADD COLUMN third_selected_subject TEXT`);
    }

    const teacherClassColumns = db.prepare(`PRAGMA table_info(teacher_class_links)`).all() as Array<{ name: string }>;
    if (!teacherClassColumns.some((item) => item.name === "subject_name")) {
        db.exec(`ALTER TABLE teacher_class_links ADD COLUMN subject_name TEXT`);
    }

    db.prepare(
        `UPDATE teacher_class_links
         SET subject_name = CASE WHEN is_head_teacher = 1 THEN '班主任' ELSE '学科待完善' END
         WHERE subject_name IS NULL OR TRIM(subject_name) = ''`
    ).run();

    const studentNormalizeStmt = db.prepare(
        `UPDATE students
         SET academic_stage = ?,
             subject_selection_status = ?,
             first_selected_subject = ?,
             second_selected_subject = ?,
             third_selected_subject = ?,
             subject_combination = ?
         WHERE id = ?`
    );

    const studentRows = db
        .prepare(
            `SELECT id, grade, subject_combination as subjectCombination,
                    academic_stage as academicStage,
                    first_selected_subject as firstSelectedSubject,
                    second_selected_subject as secondSelectedSubject,
                    third_selected_subject as thirdSelectedSubject
             FROM students`
        )
        .all() as Array<{
        id: number;
        grade: string;
        subjectCombination: string | null;
        academicStage: string | null;
        firstSelectedSubject: string | null;
        secondSelectedSubject: string | null;
        thirdSelectedSubject: string | null;
    }>;

    for (const row of studentRows) {
        const stageCandidate = row.academicStage;
        const stage =
            stageCandidate &&
            (stageCandidate === "高一上" || stageCandidate === "高一下" || stageCandidate === "高二" || stageCandidate === "高三") &&
            isValidStageForGrade(row.grade, stageCandidate)
                ? stageCandidate
                : normalizeStageFromGrade(row.grade, row.id);

        const parsedCombination = parseSubjectCombination(row.subjectCombination);
        const first = row.firstSelectedSubject ?? parsedCombination.first;
        const second = row.secondSelectedSubject ?? parsedCombination.second;
        const third = row.thirdSelectedSubject ?? parsedCombination.third;

        const validated = validateSelectionByStage({
            stage,
            firstSelectedSubject: first,
            secondSelectedSubject: second,
            thirdSelectedSubject: third
        });

        if (validated.ok) {
            studentNormalizeStmt.run(
                stage,
                validated.selectionStatus,
                validated.firstSelectedSubject,
                validated.secondSelectedSubject,
                validated.thirdSelectedSubject,
                validated.subjectCombination,
                row.id
            );
        } else {
            studentNormalizeStmt.run(stage, "locked", null, null, null, null, row.id);
        }
    }

    const chatMessageColumns = db
        .prepare(`PRAGMA table_info(chat_messages)`)
        .all() as Array<{ name: string }>;
    const hasReasoningColumn = chatMessageColumns.some((item) => item.name === "reasoning_content");
    if (!hasReasoningColumn) {
        db.exec(`ALTER TABLE chat_messages ADD COLUMN reasoning_content TEXT`);
    }

    seedPublicData();
    seedDemoData();

    const expireBefore = dayjs().subtract(7, "day").toISOString();
    db.prepare(
        `DELETE FROM chat_messages
         WHERE session_id IN (
            SELECT id FROM chat_sessions WHERE updated_at < ?
         )`
    ).run(expireBefore);
    db.prepare(`DELETE FROM chat_sessions WHERE updated_at < ?`).run(expireBefore);
};
