import Database from "better-sqlite3";
import dayjs from "dayjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROLES } from "./constants.js";
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
      interests TEXT,
      career_goal TEXT,
      parent_user_id INTEGER,
      created_at TEXT NOT NULL
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
  `);
};

const createUser = (username: string, displayName: string, role: string, password: string, linkedStudentId: number | null = null): void => {
  db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, linked_student_id, created_at)
     VALUES (@username, @displayName, @passwordHash, @role, @linkedStudentId, @createdAt)`
  ).run({
    username,
    displayName,
    passwordHash: hashPassword(password),
    role,
    linkedStudentId,
    createdAt: dayjs().toISOString()
  });
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
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (userCount.count > 0) {
    return;
  }

  createUser("admin", "系统管理员", ROLES.ADMIN, "admin123");
  createUser("teacher_zhang", "张老师", ROLES.TEACHER, "teacher123");
  createUser("head_li", "李班主任", ROLES.HEAD_TEACHER, "head123");
  createUser("parent_wang", "王家长", ROLES.PARENT, "parent123");

  const insertStudent = db.prepare(
    `INSERT INTO students (student_no, name, grade, class_name, subject_combination, interests, career_goal, parent_user_id, created_at)
     VALUES (@studentNo, @name, @grade, @className, @subjectCombination, @interests, @careerGoal, @parentUserId, @createdAt)`
  );

  const classes = ["高一(1)班", "高一(2)班", "高二(1)班", "高二(2)班", "高三(1)班"];
  const combinations = ["物理+化学+生物", "物理+化学+政治", "物理+生物+地理", "历史+政治+地理", "历史+生物+地理"];
  const interests = ["编程,机器人", "文学,历史", "生物,医学", "法律,辩论", "财经,管理", "艺术,设计"];
  const goals = ["人工智能工程师", "临床医生", "中学教师", "律师", "产品经理", "数据分析师"];

  for (let i = 1; i <= 120; i += 1) {
    const grade = i <= 40 ? "高一" : i <= 80 ? "高二" : "高三";
    insertStudent.run({
      studentNo: `S2026${String(i).padStart(3, "0")}`,
      name: `学生${String(i).padStart(3, "0")}`,
      grade,
      className: classes[i % classes.length],
      subjectCombination: combinations[i % combinations.length],
      interests: interests[i % interests.length],
      careerGoal: goals[i % goals.length],
      parentUserId: 4,
      createdAt: dayjs().subtract(8, "month").toISOString()
    });
  }

  const firstStudent = db.prepare("SELECT id FROM students ORDER BY id LIMIT 1").get() as { id: number };
  createUser("student_001", "演示学生", ROLES.STUDENT, "student123", firstStudent.id);

  db.prepare("UPDATE users SET linked_student_id = ? WHERE username = 'student_001'").run(firstStudent.id);

  const subjects = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "政治", "地理"];
  const exams = [
    { name: "2025学年第一学期期中", date: "2025-11-15" },
    { name: "2025学年第一学期期末", date: "2026-01-20" },
    { name: "2025学年第二学期月考", date: "2026-03-12" }
  ];

  const students = db.prepare("SELECT id FROM students").all() as Array<{ id: number }>;
  const resultStmt = db.prepare(
    `INSERT INTO exam_results (student_id, subject, exam_name, exam_date, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const student of students) {
    for (const exam of exams) {
      for (const subject of subjects) {
        const base = 55 + ((student.id * 7 + subject.length * 5) % 45);
        const noise = (student.id + subject.charCodeAt(0)) % 6;
        resultStmt.run(student.id, subject, exam.name, exam.date, Math.min(100, base + noise), dayjs().toISOString());
      }
    }
  }

  const growthStmt = db.prepare(
    `INSERT INTO growth_profiles (student_id, summary, risk_level, last_updated)
     VALUES (?, ?, ?, ?)`
  );
  const alertStmt = db.prepare(
    `INSERT INTO alerts (student_id, alert_type, content, status, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  for (const student of students) {
    const risk = student.id % 5 === 0 ? "high" : student.id % 3 === 0 ? "medium" : "low";
    growthStmt.run(student.id, `学生${student.id}在最近三次考试中表现稳定，建议强化弱势学科的阶段复盘。`, risk, dayjs().toISOString());

    if (risk !== "low") {
      alertStmt.run(
        student.id,
        "academic",
        risk === "high" ? "连续两次月考数学低于60分，建议一对一干预。" : "英语成绩波动较大，建议增加听力训练。",
        "open",
        dayjs().subtract(student.id % 10, "day").toISOString()
      );
    }
  }

  db.prepare(
    `INSERT INTO career_recommendations (student_id, model, selected_combination, reasoning, major_suggestions, score_breakdown, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    firstStudent.id,
    "glm-4.7-flash",
    "物理+化学+生物",
    "学生理科成绩稳定，且职业兴趣集中在工程和医学方向，推荐该组合以保持专业覆盖面。",
    "计算机科学与技术,自动化,临床医学",
    JSON.stringify({ logic: 88, language: 72, science: 91, stability: 84 }),
    dayjs().toISOString()
  );

  db.prepare(
    `INSERT INTO messages (sender_user_id, receiver_user_id, receiver_role, title, content, module, created_at, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(3, 4, ROLES.PARENT, "高二年级选科说明会通知", "本周五19:00召开线上选科说明会，请家长准时参加。", "home-school", dayjs().toISOString(), 0);

  db.prepare(
    `INSERT INTO leave_requests (student_id, parent_user_id, reason, start_date, end_date, status, review_note, reviewed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(firstStudent.id, 4, "流感居家观察", "2026-04-17", "2026-04-18", "pending", null, null, dayjs().toISOString());

  db.prepare(
    `INSERT INTO teaching_tasks (teacher_user_id, title, task_type, status, due_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`
  ).run(
    2,
    "高二数学期中复习教案优化",
    "lesson_plan",
    "in_progress",
    "2026-04-20",
    dayjs().toISOString(),
    3,
    "班级家长会学情分析报告",
    "communication",
    "todo",
    "2026-04-22",
    dayjs().toISOString()
  );

  db.prepare(
    `INSERT INTO teaching_research (teacher_user_id, title, content, category, performance_score, created_at)
     VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`
  ).run(
    2,
    "分层作业在函数单元中的应用",
    "通过难度分层作业提升中下游学生跟进效率，整体作业完成率提高14%。",
    "教研论文",
    87.5,
    dayjs().toISOString(),
    3,
    "班级共育机制优化",
    "建立每周家校反馈闭环后，家长消息已读率从61%提升到93%。",
    "班主任管理",
    91.2,
    dayjs().toISOString()
  );

  const inviteStmt = db.prepare(
    `INSERT INTO invite_codes (code, role, expires_at, used, created_at)
     VALUES (?, ?, ?, 0, ?)`
  );

  inviteStmt.run("INVITE-TEACHER-2026", ROLES.TEACHER, dayjs().add(90, "day").toISOString(), dayjs().toISOString());
  inviteStmt.run("INVITE-PARENT-2026", ROLES.PARENT, dayjs().add(90, "day").toISOString(), dayjs().toISOString());
  inviteStmt.run("INVITE-STUDENT-2026", ROLES.STUDENT, dayjs().add(90, "day").toISOString(), dayjs().toISOString());
};

export const initDatabase = (): void => {
  createSchema();
  seedPublicData();
  seedDemoData();
};
