# 高中AI管理辅助系统

一个面向高中场景的一体化管理与决策辅助平台，包含四大核心业务系统，并内置国产大模型能力。

适合场景：

- 学校内部演示与试点
- 创AI案例评比答辩
- 小规模上线与持续迭代

## 1. 你可以先看这里

如果你是第一次接触本项目，按下面顺序阅读即可：

1. 本文档第 3 节：3 分钟快速上手
2. 本文档第 4 节：演示账号与角色
3. GUIDE.md：按角色、按模块的详细操作手册

如果你已经部署到服务器，默认线上入口为：

- 前端页面：http://47.116.199.144:8082
- 后端健康检查：http://47.116.199.144:8082/health

## 2. 系统能力总览

### 2.1 四大业务系统

1. 家校沟通系统
2. 生涯规划与选课系统
3. 学业成长追踪系统
4. 教学教研管理系统

### 2.2 AI 助手中心

- 支持智谱模型切换
- 支持模板化业务场景（生涯、成长、家校、教研）
- 支持会话历史、上下文续聊、结构化输出渲染

### 2.3 管理与取证能力

- 审计日志查询与导出
- 模块级数据导出
- 评比证据包导出
- 班主任工作台

## 3. 3 分钟快速上手

### 3.1 环境要求

- Node.js >= 20
- npm >= 10
- pnpm >= 9（可选）

### 3.2 安装依赖

```bash
npm install
# 或
pnpm install
```

### 3.3 启动开发环境

```bash
npm run dev
# 或
pnpm dev
```

默认地址：

- 前端：http://localhost:3000
- 后端：http://localhost:4000

说明：

- 前端默认通过同源 /api 访问后端。
- 本地开发时 Vite 已内置 /api -> http://localhost:4000 代理。

### 3.4 构建生产版本

```bash
npm run build
# 或
pnpm build
```

### 3.5 VS Code 调试

项目已提供 .vscode 调试配置：

- Full Stack Debug：同时启动前后端
- Debug Backend Only：仅后端
- Debug Frontend (Manual Browser)：仅前端并手动打开浏览器

## 4. 演示账号与角色

可直接用于演示：

- admin / admin123
- teacher_zhang / teacher123
- head_li / head123
- parent_wang / parent123
- student_001 / student123

角色权限说明：

- admin：全功能
- teacher：教学教研、家校沟通、成长查看、选课建议
- head_teacher：班主任工作台 + 教师能力
- parent：家校沟通、孩子成长查看
- student：个人学习相关视图

## 5. 项目结构

```text
.
├── apps
│   ├── backend
│   │   ├── src
│   │   ├── templates
│   │   └── data
│   └── frontend
│       └── src
├── deploy
├── docs
├── GUIDE.md
├── DESIGN.md
└── README.md
```

## 6. 核心数据说明

### 6.1 内置演示数据

- 学生规模：支持千人级样本（当前部署数据为 1000+）
- 多次考试成绩与趋势
- 成长画像与预警
- 公开专业选科要求数据

### 6.2 真实数据导入

模板文件：

- apps/backend/templates/students-template.csv
- apps/backend/templates/exam-results-template.csv
- apps/backend/templates/teachers-template.csv

导入接口：

- POST /api/data-import/students
- POST /api/data-import/exam-results
- POST /api/data-import/teachers

## 7. 部署说明（简版）

参考文件：

- deploy/nginx.conf.example
- deploy/backend.service.example
- deploy/deploy.sh

当前线上部署要点：

- 前端静态目录：/var/www/management-system/frontend/dist
- 后端服务：management-system-backend.service
- 对外端口：8082
- 后端端口：8002
- 自动同步任务：ManagementSystem-自动同步部署（每 10 分钟）

## 8. 常见问题（强烈建议先看）

### 8.1 登录时报错：无法连接服务器 / CORS

排查顺序：

1. 确认打开的是正确地址：http://47.116.199.144:8082
2. 确认请求是发往 /api 而不是 http://localhost:4000
3. 刷新浏览器缓存后重试

### 8.2 控制台出现 runtime.connect 错误

这通常来自浏览器扩展，不是本项目后端报错。建议：

1. 用无痕模式重试
2. 暂时禁用扩展后重试

### 8.3 登录页应不应该默认填账号密码

不应该。当前版本已修复为首次进入空表单，并支持密码显示/隐藏切换。

## 9. 推荐阅读文档

- GUIDE.md：完整用户操作手册
- DESIGN.md：视觉规范
- docs/defense-demo-script.md：8 分钟答辩脚本
- docs/evaluation-checklist.md：评比核对清单
- docs/ai-generated-content-policy.md：AI 内容标识规范
- docs/how-to-build-with-ai-from-zero.md：从 0 到 1 指挥 AI 工程实战

## 10. 安全与合规说明

已实现：

- JWT 登录鉴权
- RBAC 角色权限
- 基础限流
- Helmet 安全头
- 审计日志

注意：

- 本项目面向评比与演示，不等同于高强度生产安全基线。
- 涉及真实学生数据时，请先脱敏并遵循学校数据治理要求。

## 11. 许可证

本仓库采用双许可证：

- 代码：PolyForm Noncommercial 1.0.0
- 文档与演示材料：CC BY-NC-SA 4.0

版权归属：Sun Jiantong
未经授权禁止商用。
